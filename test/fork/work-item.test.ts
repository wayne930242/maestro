import "../isolated-agent-dir.ts";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { Value } from "@sinclair/typebox/value";
import { SubagentParams } from "../../pi-extension/subagents/catalog.ts";
import { createDelivery } from "../../pi-extension/subagents/delivery.ts";
import { createLaunchPlanner } from "../../pi-extension/subagents/launch.ts";
import { registerSubagentTool } from "../../pi-extension/subagents/launch-tools.ts";
import { createMockExtensionApi } from "../helpers/mock-extension-api.ts";
import { fixture } from "./pi-run-session-fixture.ts";

const uid = "t_abcdef2345";
const legacy = "01a2130c#12";
const invalid = [
	"",
	"a brief",
	"t_0123456789",
	"123#2",
	"01a2130c#0",
	`${uid}\n`,
];

test("subagent accepts only a todo uid or session prefix and positive task number", () => {
	const params = { name: "builder", task: "private brief" };
	assert.ok(Value.Check(SubagentParams, params));
	for (const item of [uid, legacy])
		assert.ok(Value.Check(SubagentParams, { ...params, item }));
	for (const item of invalid)
		assert.equal(
			Value.Check(SubagentParams, { ...params, item }),
			false,
			JSON.stringify(item),
		);
});

for (const item of [uid, legacy, undefined]) {
	test(`subagent acknowledgement and outcome identify the launching work item: ${item ?? "omitted"}`, () =>
		fixture(async (f) => {
			const { api, registeredTools, sentMessages } = createMockExtensionApi();
			api.getThinkingLevel = () => "high";
			const runtime = {
				pi: api,
				runningSubagents: new Map(),
				session: f.session,
			};
			const snapshot = f.options.getLaunchSnapshot();
			const planner = createLaunchPlanner({
				runtime,
				modelConfig: { agents: {} },
				paneConfig: snapshot.paneConfig,
			});
			registerSubagentTool(api, {
				...planner,
				runtime,
				shouldRegister: () => true,
				updateWidget() {},
				subagentRoutingGuidelines: [],
				persistentCapacityError: () => undefined,
				spawningConfig: { maxDepth: 2 },
			});
			f.options.hooks.onSettled = createDelivery({
				runtime,
				updateWidget() {},
				startPersistentStopTimeout() {},
			}).deliverPiCompletion;
			const model = { provider: "test", id: "one", reasoning: true };
			const parent = "01a2130c-b6fb-72a9-b04f-bed99d365c74";
			const tool = registeredTools.find((t) => t.name === "subagent");
			const result = await tool.execute(
				"launch",
				{ name: "builder", task: "private brief", item },
				undefined,
				undefined,
				{
					cwd: f.dir,
					model,
					modelRegistry: {
						find: () => model,
						getAvailable: () => [model],
						hasConfiguredAuth: () => true,
					},
					sessionManager: {
						getSessionId: () => parent,
						getSessionFile: () => snapshot.parent.sessionFile,
						getSessionDir: () => snapshot.parent.sessionDir,
					},
				},
			);
			const record = f.session.getRecord(result.details.id);
			assert.ok(record);
			const done = f.session.supervise(
				f.session.getHandle(record.id)!,
				f.session.getTask(record.id)!,
			);
			f.complete(record);
			await done;
			const raw = readFileSync(
				join(f.dir, "herdr-agents", "outcomes.jsonl"),
				"utf8",
			).trimEnd();
			assert.doesNotMatch(raw, /private brief|\n/);
			const line = JSON.parse(raw);
			assert.equal(line.name, "builder");
			assert.equal(line.parent, parent);
			assert.equal(line.runId, result.details.id);
			const [message] = sentMessages;
			assert.equal(message.message.customType, "subagent_result");
			for (const actual of [result.details, line, message.message.details]) {
				assert.equal(Object.hasOwn(actual, "item"), item !== undefined);
				assert.equal(actual.item, item);
			}
		}));
}

test("fallback outcome rows keep the first launching session id across session replacement", () =>
	fixture(async (f) => {
		const input = f.input();
		input.task.item = legacy;
		const plan = input.plans[0];
		input.plans = [plan, { ...plan, model: "test/two", modelId: "two" }];
		input.prepareAttempt = (index) => {
			const snapshot = f.options.getLaunchSnapshot();
			snapshot.parent.sessionId = index === 0 ? "original" : "replacement";
			return {
				...input,
				snapshot,
				identity: { ...input.identity, generationId: `gen-${index}` },
			};
		};
		f.options.hooks.onSpawned = (record) => {
			f.complete(
				record,
				record.runtimePlan?.model === plan.model
					? { type: "error", errorMessage: "first provider unavailable" }
					: { type: "done" },
			);
		};
		const handle = await f.session.spawnPi(input);
		await f.session.supervise(handle, input.task);
		const rows = readFileSync(
			join(f.dir, "herdr-agents", "outcomes.jsonl"),
			"utf8",
		)
			.trimEnd()
			.split("\n")
			.map((line) => JSON.parse(line));
		assert.deepEqual(
			rows.map(({ attempt, parent, item }) => [attempt, parent, item]),
			[
				[1, "original", legacy],
				[2, "original", legacy],
			],
		);
	}));

test("an invalid engine task item is refused before launch", () =>
	fixture(async (f) => {
		const input = f.input();
		await assert.rejects(
			f.session.spawnPi({
				...input,
				task: { ...input.task, item: "private brief" },
			}),
			/work item/i,
		);
		assert.equal(f.commands.length, 0);
	}));
