import "../clean-host-env.ts";
import "../isolated-agent-dir.ts";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	TRACKED_RUNS_CHANNEL,
	projectTrackedRuns,
	readTrackedRuns,
	type TrackedRunRow,
	type TrackedRunsProbe,
} from "../../maestro/core/tracked-runs.ts";
import { hasUndeliveredChildren } from "../../maestro/core/undelivered-children.ts";
import { createLifecycle, markDelivery } from "../../maestro/core/lifecycle.ts";
import type { CompletionDelivery } from "../../maestro/core/types.ts";
import type { RunningSubagent } from "../../pi-extension/subagents/state.ts";
import { createEventBus } from "@earendil-works/pi-coding-agent";
import { createMockExtensionApi } from "../helpers/mock-extension-api.ts";
import * as host from "../helpers/pi-extension.ts";

const registry = host.__test__.runningSubagents;

function row(
	id: string,
	extra: {
		agent?: string;
		persistent?: boolean;
		delivery?: CompletionDelivery;
	} = {},
): RunningSubagent {
	const lifecycle = createLifecycle(Date.now());
	return {
		id,
		name: `Run ${id}`,
		task: "work",
		agent: extra.agent,
		surface: "pane",
		startTime: Date.now(),
		sessionFile: `/tmp/${id}.jsonl`,
		interactive: false,
		runtimePlan: undefined,
		lifecycle: extra.delivery
			? markDelivery(lifecycle, extra.delivery)
			: lifecycle,
		persistent: extra.persistent,
	};
}

describe("tracked-run snapshot (pi-herdr-agents:runs:v1)", () => {
	it("keeps the branded, versioned channel name", () => {
		assert.equal(TRACKED_RUNS_CHANNEL, "pi-herdr-agents:runs:v1");
	});

	it("projects id, name, agent, persistent and delivery in registry order", () => {
		const rows = new Map<string, TrackedRunRow>([
			["a", { name: "Scout", agent: "scout" }],
			["b", { name: "Docs", persistent: true }],
			["c", { name: "Held", lifecycle: { delivery: "pending" } }],
			["d", { name: "Gone", lifecycle: { delivery: "suppressed" } }],
		]);
		assert.deepEqual(projectTrackedRuns(rows), {
			version: 1,
			runs: [
				{
					id: "a",
					name: "Scout",
					agent: "scout",
					persistent: false,
					delivery: "pending",
				},
				{ id: "b", name: "Docs", persistent: true, delivery: "pending" },
				{ id: "c", name: "Held", persistent: false, delivery: "pending" },
				{ id: "d", name: "Gone", persistent: false, delivery: "suppressed" },
			],
		});
		const [first] = projectTrackedRuns(rows).runs;
		assert.equal(Object.hasOwn(first!, "agent"), true);
		const [, second] = projectTrackedRuns(rows).runs;
		assert.equal(Object.hasOwn(second!, "agent"), false);
	});

	it("answers an empty snapshot for no registry or an empty one", () => {
		assert.deepEqual(projectTrackedRuns(undefined), { version: 1, runs: [] });
		assert.deepEqual(projectTrackedRuns(new Map()), { version: 1, runs: [] });
	});

	it("a row without a name (an older slot) uses its id", () => {
		assert.deepEqual(projectTrackedRuns(new Map([["legacy", {}]])).runs, [
			{ id: "legacy", name: "legacy", persistent: false, delivery: "pending" },
		]);
	});

	it("returns copies, never the registry's own rows", () => {
		const source: TrackedRunRow = { name: "Scout", agent: "scout" };
		const rows = new Map([["a", source]]);
		const snapshot = projectTrackedRuns(rows);
		snapshot.runs[0]!.name = "changed";
		snapshot.runs.push({
			id: "x",
			name: "x",
			persistent: false,
			delivery: "pending",
		});
		assert.equal(source.name, "Scout");
		assert.equal(rows.size, 1);
	});

	it("readTrackedRuns: no listener means no answer", () => {
		assert.equal(readTrackedRuns(undefined), undefined);
		assert.equal(readTrackedRuns({ emit() {} }), undefined);
		assert.deepEqual(
			readTrackedRuns({
				emit(channel, probe) {
					assert.equal(channel, TRACKED_RUNS_CHANNEL);
					probe.snapshot = { version: 1, runs: [] };
				},
			}),
			{ version: 1, runs: [] },
		);
	});

	it("the exit guard reads the same projection", () => {
		const cases: Map<string, TrackedRunRow>[] = [
			new Map(),
			new Map([["legacy", {}]]),
			new Map([["persistent", { persistent: true }]]),
			new Map([["delivered", { lifecycle: { delivery: "delivered" } }]]),
			new Map([["suppressed", { lifecycle: { delivery: "suppressed" } }]]),
			new Map<string, TrackedRunRow>([
				["persistent", { persistent: true }],
				["ordinary", { lifecycle: { delivery: "pending" } }],
			]),
		];
		for (const runningSubagents of cases)
			assert.equal(
				hasUndeliveredChildren({ runningSubagents }),
				projectTrackedRuns(runningSubagents).runs.some(
					(run) => !run.persistent && run.delivery === "pending",
				),
			);
	});

	describe("the subagents extension answers the probe", () => {
		it("with the rows it tracks now, and empty when it tracks none", () => {
			registry.clear();
			const { api, eventHandlers } = createMockExtensionApi();
			host.default(api);
			try {
				assert.deepEqual(readTrackedRuns(api.events), {
					version: 1,
					runs: [],
				});
				registry.set("w1", row("w1", { agent: "worker" }));
				registry.set("p1", row("p1", { persistent: true }));
				assert.deepEqual(readTrackedRuns(api.events), {
					version: 1,
					runs: [
						{
							id: "w1",
							name: "Run w1",
							agent: "worker",
							persistent: false,
							delivery: "pending",
						},
						{
							id: "p1",
							name: "Run p1",
							persistent: true,
							delivery: "pending",
						},
					],
				});
				// Ordinary completion removes the row before it sends the result.
				registry.delete("w1");
				assert.deepEqual(
					readTrackedRuns(api.events)?.runs.map((run) => run.id),
					["p1"],
				);
			} finally {
				registry.clear();
				for (const handler of eventHandlers.get("session_shutdown") ?? [])
					void handler({ reason: "quit" }, {});
			}
		});

		it("answers through a raw emit, as another extension calls it", () => {
			registry.clear();
			const { api, eventHandlers } = createMockExtensionApi();
			host.default(api);
			try {
				registry.set("s1", row("s1", { delivery: "suppressed" }));
				const probe: TrackedRunsProbe = {};
				api.events.emit(TRACKED_RUNS_CHANNEL, probe);
				assert.deepEqual(probe.snapshot, {
					version: 1,
					runs: [
						{
							id: "s1",
							name: "Run s1",
							persistent: false,
							delivery: "suppressed",
						},
					],
				});
				// A malformed probe is ignored rather than thrown on.
				assert.doesNotThrow(() =>
					api.events.emit(TRACKED_RUNS_CHANNEL, undefined),
				);
			} finally {
				registry.clear();
				for (const handler of eventHandlers.get("session_shutdown") ?? [])
					void handler({ reason: "quit" }, {});
			}
		});

		it("after /reload the replacement load answers for the rows it adopted", async () => {
			registry.clear();
			const bus = createEventBus();
			const first = createMockExtensionApi(bus);
			host.default(first.api);
			registry.set("r1", row("r1", { agent: "worker" }));
			try {
				for (const handler of first.eventHandlers.get("session_shutdown") ?? [])
					await handler({ reason: "reload" }, {});
				// The reload keeps the row; the old load no longer answers.
				assert.equal(registry.has("r1"), true);
				assert.equal(readTrackedRuns(bus), undefined);
				const second = createMockExtensionApi(bus);
				host.default(second.api);
				assert.deepEqual(
					readTrackedRuns(bus)?.runs.map((run) => run.id),
					["r1"],
				);
				registry.clear();
				for (const handler of second.eventHandlers.get("session_shutdown") ??
					[])
					await handler({ reason: "quit" }, {});
			} finally {
				registry.clear();
			}
		});

		it("stops answering once its session shuts down", async () => {
			registry.clear();
			const { api, eventHandlers } = createMockExtensionApi();
			host.default(api);
			for (const handler of eventHandlers.get("session_shutdown") ?? [])
				await handler({ reason: "quit" }, {});
			assert.equal(readTrackedRuns(api.events), undefined);
		});
	});
});
