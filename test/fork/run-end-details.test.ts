import "../isolated-agent-dir.ts";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { writeSubagentSessionPolicy } from "../../maestro/adapters/pi/session.ts";
import { createDelivery } from "../../pi-extension/subagents/delivery.ts";
import type {
	SubagentPingDetails,
	SubagentResultDetails,
} from "../../pi-extension/subagents/presentation.ts";
import { createMockExtensionApi } from "../helpers/mock-extension-api.ts";
import { fixture } from "./pi-run-session-fixture.ts";

// A run's end names its run: `details.id` is the id the launch acknowledged, on every
// `subagent_result` and `subagent_ping`, so a host ties an end to its launch without
// guessing from names or files. `details.attempts` lists every spawned attempt
// (`model`, `sessionFile`, `elapsed`), failed fallbacks included, and a ping names
// its `elapsed` as a result does.

function deliverTo(f: Parameters<Parameters<typeof fixture>[0]>[0]) {
	const { api, sentMessages } = createMockExtensionApi();
	const runtime = {
		pi: api,
		liveApi: api,
		runningSubagents: new Map(),
		session: f.session,
	};
	f.options.hooks.onSettled = createDelivery({
		runtime,
		updateWidget() {},
		startPersistentStopTimeout() {},
	}).deliverPiCompletion;
	const sent: {
		message: {
			customType: string;
			details: SubagentResultDetails & SubagentPingDetails;
		};
	}[] = sentMessages;
	return sent;
}

test("a result names its run id and every spawned attempt, the failed fallback first", () =>
	fixture(async (f) => {
		const sent = deliverTo(f);
		const input = f.input();
		const plan = input.plans[0];
		input.plans = [plan, { ...plan, model: "test/two", modelId: "two" }];
		const files: string[] = [];
		f.options.hooks.onSpawned = (record) => {
			files.push(record.sessionFile);
			f.complete(
				record,
				record.runtimePlan?.model === plan.model
					? { type: "error", errorMessage: "first provider unavailable" }
					: { type: "done" },
			);
		};
		const handle = await f.session.spawnPi(input);
		await f.session.supervise(handle, input.task);
		assert.equal(sent.length, 1);
		const { customType, details } = sent[0].message;
		assert.equal(customType, "subagent_result");
		assert.equal(details.id, handle.id);
		assert.equal(files.length, 2);
		const attempts = details.attempts ?? [];
		assert.deepEqual(
			attempts.map(({ model, sessionFile }) => [model, sessionFile]),
			[
				["test/one", files[0]],
				["test/two", files[1]],
			],
		);
		for (const a of attempts)
			assert.ok(Number.isInteger(a.elapsed) && a.elapsed >= 0);
		assert.equal(attempts.at(-1)!.elapsed, details.elapsed);
		assert.equal(details.sessionFile, files[1]);
	}));

test("a ping names its run id, its elapsed, and its attempt", () =>
	fixture(async (f) => {
		const sent = deliverTo(f);
		const input = f.input();
		let file = "";
		f.options.hooks.onSpawned = (record) => {
			file = record.sessionFile;
			f.complete(record, { type: "ping", name: "child", message: "help" });
		};
		const handle = await f.session.spawnPi(input);
		await f.session.supervise(handle, input.task);
		assert.equal(sent.length, 1);
		const { customType, details } = sent[0].message;
		assert.equal(customType, "subagent_ping");
		assert.equal(details.id, handle.id);
		assert.ok(Number.isInteger(details.elapsed));
		assert.deepEqual(details.attempts, [
			{ model: "test/one", sessionFile: file, elapsed: details.elapsed },
		]);
	}));

test("a cancelled result names its run id and the attempt it stopped", () =>
	fixture(async (f) => {
		const sent = deliverTo(f);
		const input = f.input();
		const handle = await f.session.spawnPi(input);
		const done = f.session.supervise(handle, input.task);
		await f.session.cancel(input.task.id);
		await done;
		assert.equal(sent.length, 1);
		const { details } = sent[0].message;
		assert.equal(details.error, "cancelled");
		assert.equal(details.id, handle.id);
		const attempts = details.attempts ?? [];
		assert.deepEqual(
			attempts.map((a) => a.model),
			["test/one"],
		);
	}));

test("a resume's result names the resume's run id and its one attempt, the resumed file", () =>
	fixture(async (f) => {
		const sent = deliverTo(f);
		const path = join(f.dir, "saved.jsonl");
		writeFileSync(
			path,
			JSON.stringify({ type: "session", version: 3, id: "saved", cwd: f.dir }) +
				"\n",
		);
		writeSubagentSessionPolicy(path, { owner: "public", deniedTools: [] });
		const handle = await f.session.resumePi({
			taskId: "resume-control",
			name: "resumed",
			sessionPath: path,
		});
		const id = f.session.getStarted("resume-control")!.id;
		const done = f.session.supervise(
			handle,
			f.session.getTask("resume-control")!,
		);
		f.complete(f.latest()!);
		await done;
		assert.equal(sent.length, 1);
		const { details } = sent[0].message;
		assert.equal(details.id, id);
		const attempts = details.attempts ?? [];
		assert.equal(attempts.length, 1);
		assert.equal(attempts[0].sessionFile, path);
		assert.equal(attempts[0].elapsed, details.elapsed);
	}));
