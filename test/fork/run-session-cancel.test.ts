// weihung fork: unconfirmed-cancel re-observation cases (pi-herdr-agents fork
// 4921564) with the run-session-cancel.test.ts fixture they extend.
import "../clean-host-env.ts";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { FakeHarnessAdapter } from "../../maestro/adapters/fake/fake-harness-adapter.ts";
import type { SpawnOptions } from "../../maestro/core/harness-adapter.ts";
import type {
	AgentHandle,
	Role,
	RunResult,
	Task,
} from "../../maestro/core/types.ts";
import {
	createRunSession,
	type OwnedRunAttempt,
	type PreparedRun,
} from "../../maestro/engine.ts";

const role: Role = {
	name: "worker",
	version: "1",
	description: "writer",
	systemPrompt: "role prompt",
	allowedTools: ["read"],
};
const candidates = [
	{ model: "provider/first", thinking: "low" as const },
	{ model: "provider/second", thinking: "high" as const },
	{ model: "provider/third", thinking: "off" as const },
];
function task(overrides: Partial<Task> = {}): Task {
	return {
		id: "logical",
		name: "writer",
		prompt: "do the work",
		role: "worker",
		cwd: "/source",
		runtime: { ...candidates[0], fallbacks: candidates.slice(1) },
		...overrides,
	};
}
const turn = () => new Promise<void>((resolve) => setImmediate(resolve));
// The kernel's re-observation timers are unref'd, like a parent session's other
// background timers. A test that only awaits their outcome keeps the loop alive.
async function whileParentLoopAlive<T>(run: () => Promise<T>): Promise<T> {
	const anchor = setInterval(() => {}, 1_000);
	try {
		return await run();
	} finally {
		clearInterval(anchor);
	}
}
async function until(predicate: () => boolean, what: string) {
	const deadline = Date.now() + 2_000;
	while (!predicate()) {
		assert.ok(Date.now() < deadline, `timed out waiting for ${what}`);
		await new Promise((resolve) => setTimeout(resolve, 1));
	}
}

/**
 * The fake's kill settles error evidence, exactly like a closed Herdr pane that
 * the watcher reports as "pane disappeared": the incident's fallback trigger.
 */
class Adapter extends FakeHarnessAdapter {
	launches: SpawnOptions[] = [];
	kills: string[] = [];
	/** Order of observable effects, for intent-before-kill assertions. */
	events: string[] = [];
	killGate?: Promise<void>;
	killError?: () => Error | undefined;
	override async spawn(options: SpawnOptions) {
		this.launches.push(options);
		return super.spawn(options);
	}
	override async kill(handle: AgentHandle) {
		this.kills.push(handle.id);
		this.events.push(`kill:${handle.id}`);
		await this.killGate;
		const error = this.killError?.();
		if (error) throw error;
		await super.kill(handle);
	}
}
/**
 * The pane or process the kill could not confirm later disappears: the
 * adapter's non-signalling observation starts answering `true`.
 */
class ObservingAdapter extends Adapter {
	gone = false;
	observations = 0;
	observeError?: Error;
	async confirmTerminated(_handle: AgentHandle) {
		this.observations++;
		if (this.observeError) throw this.observeError;
		return this.gone;
	}
}
function fixture(
	options: {
		finalize?: OwnedRunAttempt["finalize"];
		adapter?: Adapter;
		terminationRecheckMs?: number;
	} = {},
) {
	const adapter = options.adapter ?? new Adapter();
	const cancelStates: string[] = [];
	const delivered: RunResult[] = [];
	/** What each attempt's owner finalized (Pi persists manifests from it). */
	const finalized: RunResult[] = [];
	const closes: string[] = [];
	const hooks: string[] = [];
	const finalize: OwnedRunAttempt["finalize"] = async (result, t, control) => {
		finalized.push(result);
		return options.finalize ? options.finalize(result, t, control) : result;
	};
	const prepared = (extra: Partial<PreparedRun> = {}): PreparedRun => ({
		role,
		persistent: false,
		candidates,
		spawnAttempt: async (spawn) => {
			const handle = await adapter.spawn(spawn);
			return {
				handle,
				adapter,
				finalize,
				closeTemporarySurface: async () => {
					closes.push(handle.id);
				},
			};
		},
		...extra,
	});
	const session = createRunSession({
		adapter,
		roles: [role],
		cwd: "/parent",
		terminationRecheckMs: options.terminationRecheckMs,
		hooks: {
			onSpawned: (handle) => {
				hooks.push(`spawned:${handle.id}`);
			},
			onCancelState: (_handle, _task, state) => {
				cancelStates.push(state);
			},
			onSettled: (result) => {
				delivered.push(result);
			},
		},
	});
	return {
		adapter,
		session,
		cancelStates,
		delivered,
		finalized,
		finalize,
		closes,
		hooks,
		prepared,
	};
}
async function running(f: ReturnType<typeof fixture>, t = task()) {
	const handle = await f.session.spawn(t, f.prepared());
	const result = f.session.supervise(handle, t);
	return { t, handle, result };
}
function models(adapter: Adapter) {
	return adapter.launches.map((launch) => launch.runtime?.model);
}
function assertCancelled(result: RunResult, handle: AgentHandle) {
	assert.equal(result.outcome, "killed");
	assert.equal(result.handle, handle);
	assert.equal(result.cancellation?.termination, "confirmed");
	const { requestedAt, confirmedAt } = result.cancellation!;
	assert.ok(Number.isFinite(requestedAt));
	assert.ok(confirmedAt! >= requestedAt, "confirmed after the recorded intent");
	assert.equal(
		result.evidence,
		undefined,
		"cancel never reports natural evidence",
	);
}

describe("RunSession operator cancel (weihung fork: re-observation)", {
	timeout: 5000,
}, () => {
	it("an unconfirmed cancel settles as one cancelled result once the target is observed gone, signalling nothing more", async () => {
		await whileParentLoopAlive(async () => {
			const adapter = new ObservingAdapter();
			const f = fixture({ adapter, terminationRecheckMs: 5 });
			adapter.killError = () => new Error("pane still present");
			const { t, handle, result } = await running(f);
			let settled = false;
			void result.then(() => {
				settled = true;
			});
			assert.equal((await f.session.cancel(t.id)).status, "unconfirmed");
			// The child's Pi exits on its own and the producer makes its one kill.
			adapter.fail(handle.id, "Subagent pane disappeared");
			await until(() => adapter.observations >= 3, "repeated observations");
			assert.equal(settled, false, "a target still present settles nothing");
			assert.equal(f.delivered.length, 0);
			assert.deepEqual(adapter.kills, [handle.id, handle.id]);
			// Observation errors and a silent adapter are unknown, never gone.
			adapter.observeError = new Error("herdr unavailable");
			const seen = adapter.observations;
			await until(() => adapter.observations > seen + 1, "failed observations");
			assert.equal(settled, false);
			adapter.observeError = undefined;
			adapter.gone = true;
			assertCancelled(await result, handle);
			await turn();
			assert.equal(f.delivered.length, 1, "exactly one result");
			assert.deepEqual(adapter.kills, [handle.id, handle.id], "no extra kill");
			assert.equal(f.cancelStates.at(-1), "confirmed");
			assert.deepEqual(models(adapter), ["provider/first"]);
			const stopped = adapter.observations;
			for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 5));
			assert.equal(adapter.observations, stopped, "polling stops once settled");
		});
	});

	it("a target observed gone settles a cancel whose wait never ended on its own", async () => {
		await whileParentLoopAlive(async () => {
			const adapter = new ObservingAdapter();
			const f = fixture({ adapter, terminationRecheckMs: 5 });
			adapter.killError = () => new Error("pane close timed out");
			const { t, handle, result } = await running(f);
			assert.equal((await f.session.cancel(t.id)).status, "unconfirmed");
			assert.equal(f.cancelStates.at(-1), "unconfirmed");
			adapter.gone = true;
			assertCancelled(await result, handle);
			assert.equal(f.delivered.length, 1);
			assert.deepEqual(adapter.kills, [handle.id], "only the operator's kill");
			assert.equal(f.cancelStates.at(-1), "confirmed");
		});
	});

	it("shutdown suppression stops the observation without delivery", async () => {
		await whileParentLoopAlive(async () => {
			const adapter = new ObservingAdapter();
			const f = fixture({ adapter, terminationRecheckMs: 5 });
			adapter.killError = () => new Error("still present");
			const { t, handle, result } = await running(f);
			assert.equal((await f.session.cancel(t.id)).status, "unconfirmed");
			adapter.fail(handle.id, "pane disappeared");
			await until(() => adapter.observations >= 2, "observations");
			f.session.suppress(t.id);
			const settled = await result;
			assert.equal(settled.cancellation?.termination, "unconfirmed");
			const stopped = adapter.observations;
			adapter.gone = true;
			for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 5));
			assert.equal(
				adapter.observations,
				stopped,
				"no observation after suppress",
			);
			assert.equal(f.delivered.length, 0);
		});
	});

	it("an adapter without an observation is retried only by the operator", async () => {
		await whileParentLoopAlive(async () => {
			const f = fixture({ terminationRecheckMs: 5 });
			f.adapter.killError = () => new Error("still present");
			const { t, handle, result } = await running(f);
			let settled = false;
			void result.then(() => {
				settled = true;
			});
			assert.equal((await f.session.cancel(t.id)).status, "unconfirmed");
			for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 5));
			assert.equal(settled, false);
			assert.deepEqual(f.adapter.kills, [handle.id]);
			f.session.suppress(t.id);
			await result;
		});
	});
});
