// weihung fork: a live child's Herdr status (done/idle, blocked) reaches its
// lifecycle through the real run-session + adapter + supervision path, so the
// widget and run rows stop calling an idle or blocked child running. Coarse
// status never ends the run: done-but-alive delivers nothing.
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { test } from "node:test";
import { writeSubagentActivityFile } from "../../maestro/adapters/pi/activity-file.ts";
import { shellExitFileFor } from "../../maestro/adapters/pi/completion.ts";
import type {
	SurfaceAgentStatus,
	SubagentActivityState,
} from "../../maestro/core/types.ts";
import type { PiRunRecord } from "../../maestro/runtime/pi-run-session-types.ts";
import { fixture, turn } from "./pi-run-session-fixture.ts";

type Fixture = Parameters<Parameters<typeof fixture>[0]>[0];

interface Run {
	id: string;
	record: PiRunRecord;
	/** Writes Pi's activity snapshot for this child. */
	activity(phase: "active" | "waiting", toolName?: string): void;
	/** Scripts what Herdr reports for this child's pane. */
	pane(agentStatus: SurfaceAgentStatus): void;
	/** Starts supervision and waits for its first recorded pane inspection. */
	supervise(): Promise<void>;
	projection(): string | undefined;
	/** The Herdr status the lifecycle last recorded. */
	herdrStatus(): string | undefined;
}

let sequence = 0;

/**
 * Launch one child and always settle it afterwards, so a failed assertion
 * cannot leave a live child that blocks the fixture's shutdown.
 */
function withChild(
	name: string,
	body: (f: Fixture, run: Run) => Promise<void>,
	persistent = false,
) {
	return fixture(async (f) => {
		const input = f.input(name, persistent);
		const handle = await f.session.spawnPi(input);
		const record = f.latest()!;
		let settled: Promise<unknown> | undefined;
		const run: Run = {
			id: name,
			record,
			activity(phase, toolName) {
				const now = Date.now();
				const state: SubagentActivityState = {
					version: 1,
					runningChildId: record.id,
					createdAt: now,
					updatedAt: now,
					sequence: ++sequence,
					latestEvent: phase === "active" ? "agent_start" : "agent_end",
					phase,
					agentActive: phase === "active",
					turnActive: phase === "active",
					providerActive: false,
					toolActive: toolName !== undefined,
				};
				if (phase === "active") {
					state.activeSince = now;
					if (toolName) {
						state.activeScope = "tool";
						state.toolName = toolName;
						state.toolStartedAt = now;
					} else state.activeScope = "agent";
				} else state.waitingSince = now;
				writeSubagentActivityFile(record.activityFile, state);
			},
			pane(agentStatus) {
				f.provider.scriptInspection(record.surface, {
					kind: "present",
					agentStatus,
					observedAt: Date.now(),
				});
			},
			async supervise() {
				settled = f.session.supervise(handle, input.task);
				for (
					let i = 0;
					i < 200 && record.lifecycle.pane.kind !== "present";
					i++
				)
					await new Promise((resolve) => setTimeout(resolve, 10));
				assert.equal(record.lifecycle.pane.kind, "present");
			},
			projection: () => f.session.observe(name)?.projection.kind,
			herdrStatus: () =>
				record.lifecycle.pane.kind === "present"
					? record.lifecycle.pane.agentStatus
					: undefined,
		};
		try {
			await body(f, run);
			// Coarse status delivered nothing; only completion evidence ends the run.
			assert.equal(f.settled.length, 0);
			assert.equal(f.session.getCompleted(name), undefined);
		} finally {
			f.complete(record);
			// A persistent owner also needs its launch line's post-exit record.
			if (persistent) writeFileSync(shellExitFileFor(record.sessionFile), "0");
			await settled?.catch(() => {});
			await turn();
		}
	});
}

test("a live child Herdr reports done after a turn projects as waiting", () =>
	withChild("done", async (_f, run) => {
		run.activity("active");
		assert.equal(run.projection(), "active");
		// Pi's last snapshot still says active; only Herdr saw the turn end.
		run.pane("done");
		await run.supervise();
		assert.equal(run.herdrStatus(), "done");
		assert.equal(run.projection(), "waiting");
	}));

test("a live child Herdr reports idle after a turn projects as waiting", () =>
	withChild("idle", async (_f, run) => {
		run.activity("active");
		assert.equal(run.projection(), "active");
		// Pi's last snapshot still says active; only Herdr saw the turn end.
		run.pane("idle");
		await run.supervise();
		assert.equal(run.herdrStatus(), "idle");
		assert.equal(run.projection(), "waiting");
	}));

test("a live child Herdr reports blocked on a question projects as blocked", () =>
	withChild("blocked", async (_f, run) => {
		// Pi still reports the question tool as active; Herdr sees the dialog.
		run.activity("active", "ask_user_question");
		assert.equal(run.projection(), "active");
		run.pane("blocked");
		await run.supervise();
		assert.equal(run.herdrStatus(), "blocked");
		assert.equal(run.projection(), "blocked");
	}));

test("a live child Herdr reports working stays active", () =>
	withChild("working", async (_f, run) => {
		run.activity("active", "bash");
		run.pane("working");
		await run.supervise();
		assert.equal(run.projection(), "active");
	}));

test("a persistent specialist between tasks projects as waiting", () =>
	withChild(
		"specialist",
		async (_f, run) => {
			run.activity("active");
			run.activity("waiting");
			run.pane("done");
			await run.supervise();
			assert.equal(run.projection(), "waiting");
		},
		true,
	));

test("without a Herdr status, Pi's ended turn projects as waiting", () =>
	withChild("unknown", async (_f, run) => {
		// Herdr Core and panes without agent detection report status unknown.
		run.pane("unknown");
		await run.supervise();
		run.activity("active");
		assert.equal(run.projection(), "active");
		run.activity("waiting");
		assert.equal(run.projection(), "waiting");
	}));
