import "./clean-host-env.ts";
import assert from "node:assert/strict";
import childProcess, { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	existsSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	realpathSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { hostname, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { projectActivity } from "../maestro/core/activity.ts";
import {
	loadGuidelinesConfig,
	parseGuidelinesConfig,
} from "../maestro/core/config/guidelines-config.ts";
import {
	computeConfigRevision,
	getConfigWriteLockPath,
	loadModelConfig,
	parseModelConfig,
	readConfigRevision,
	resolveModelDefault,
	TaskModelConfigWriteError,
	writeTaskModelConfig,
} from "../maestro/core/config/model-config.ts";
import {
	createSubagentPaneFactory,
	loadPaneConfig,
	parsePaneConfig,
} from "../maestro/core/config/pane-config.ts";
import {
	loadPersistentConfig,
	parsePersistentConfig,
} from "../maestro/core/config/persistent-config.ts";
import {
	loadRoleConfig,
	parseRoleConfig,
} from "../maestro/core/config/role-config.ts";
import {
	loadSupervisionConfig,
	parseSupervisionConfig,
} from "../maestro/core/config/supervision-config.ts";
import { isPlainObject, isRecord } from "../maestro/core/config/type-guards.ts";
import { encodeHostValue } from "../maestro/core/host-text.ts";
import {
	createLifecycle,
	lifecycleTransition,
	markCompleted,
	markCompletionDetected,
	markFailed,
	markInterruptRequested,
	observeActivity as observeLifecycleActivity,
	observePaneInspection,
	projectLifecycle,
} from "../maestro/core/lifecycle.ts";
import {
	advanceStatusState,
	capStatusLines,
	classifyStatus,
	createStatusState,
	forceStatusAfterInterrupt,
	formatStatusAggregate,
	formatStatusLine,
	formatTransitionLine,
	loadStatusConfig,
	observeStatus,
	parseStatusConfig,
} from "../maestro/core/status.ts";
import {
	POLLING_INTERVAL_MS,
	SupervisionCoordinator,
} from "../maestro/core/supervision.ts";
import type { SubagentActivityState } from "../maestro/core/types.ts";
import { hasUndeliveredChildren } from "../maestro/core/undelivered-children.ts";
import { FileWakeRegistry } from "../maestro/core/wake.ts";
import { getSubagentsConfigExamplePath } from "./helpers/config-example.ts";
import "./isolated-agent-dir.ts";

function createTestDir(): string {
	return realpathSync(mkdtempSync(join(tmpdir(), "subagents-test-")));
}

function withTempDir(run: (dir: string) => void) {
	const dir = createTestDir();
	try {
		run(dir);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

describe("status.ts", () => {
	it("parses strict config objects", () => {
		const disabled = parseStatusConfig({ status: { enabled: false } });

		assert.deepEqual(disabled, {
			enabled: false,
			lineLimit: 4,
		});
	});

	it("loads a valid config file", () => {
		const examplePath = fileURLToPath(
			new URL("../config.json.example", import.meta.url),
		);
		const config = loadStatusConfig(examplePath, examplePath);

		assert.deepEqual(config, {
			enabled: true,
			lineLimit: 4,
		});
	});

	it("loads the shared example when local config is absent", () => {
		withTempDir((dir) => {
			const examplePath = join(dir, "config.json.example");
			writeFileSync(
				examplePath,
				JSON.stringify({ status: { enabled: true } }, null, 2) + "\n",
			);

			const config = loadStatusConfig(join(dir, "config.json"), examplePath);

			assert.deepEqual(config, {
				enabled: true,
				lineLimit: 4,
			});
		});
	});

	it("fails fast for invalid config shapes", () => {
		assert.throws(
			() => parseStatusConfig({ status: { enabled: "false" } }),
			/status\.enabled must be a boolean/,
		);
		assert.throws(
			() =>
				parseStatusConfig({
					status: { enabled: true, defaultCadenceSeconds: 60 },
				}),
			/status has unsupported key\(s\): defaultCadenceSeconds/,
		);
	});

	it("reports when neither local nor shared config exists", () => {
		withTempDir((dir) => {
			assert.throws(
				() =>
					loadStatusConfig(
						join(dir, "config.json"),
						join(dir, "config.json.example"),
					),
				/Missing subagent status config\. Expected .*config\.json.*or.*config\.json\.example/,
			);
		});
	});

	it("reports invalid JSON from the shared example path", () => {
		withTempDir((dir) => {
			const examplePath = join(dir, "config.json.example");
			writeFileSync(examplePath, "{\n");

			assert.throws(
				() => loadStatusConfig(join(dir, "config.json"), examplePath),
				/Invalid JSON in subagent config .*config\.json\.example/,
			);
		});
	});

	it("fails on invalid local config instead of falling back to the shared example", () => {
		withTempDir((dir) => {
			const configPath = join(dir, "config.json");
			const examplePath = join(dir, "config.json.example");
			writeFileSync(configPath, "{\n");
			writeFileSync(
				examplePath,
				JSON.stringify({ status: { enabled: true } }, null, 2) + "\n",
			);

			assert.throws(
				() => loadStatusConfig(configPath, examplePath),
				/Invalid JSON in subagent config .*config\.json/,
			);
		});
	});

	it("keeps a missing snapshot as starting until the fixed watchdog threshold", () => {
		let state = createStatusState({ startTimeMs: 0 });
		state = observeStatus(state, { snapshot: "missing" }, 1_000);

		assert.equal(classifyStatus(state, 60_999).kind, "starting");
		const stalled = classifyStatus(state, 61_000);
		assert.equal(stalled.kind, "stalled");
		assert.equal(stalled.statusLabel, null);
	});

	it("classifies active snapshots without aging into stalled", () => {
		let state = createStatusState({ startTimeMs: 0 });
		state = observeStatus(
			state,
			{
				snapshot: "present",
				updatedAt: 5_000,
				sequence: 1,
				phase: "active",
				active: true,
				activeScope: "tool",
				activeSince: 5_000,
				activityLabel: "bash",
				latestEvent: "tool_execution_start",
			},
			5_000,
		);

		const snapshot = classifyStatus(state, 240_000);
		assert.equal(snapshot.kind, "active");
		assert.equal(snapshot.activityLabel, "bash");
		assert.equal(snapshot.activeDurationText, "3m");
	});

	it("classifies waiting snapshots as healthy idle without becoming stalled", () => {
		let state = createStatusState({ startTimeMs: 0 });
		state = observeStatus(
			state,
			{
				snapshot: "present",
				updatedAt: 10_000,
				sequence: 1,
				phase: "waiting",
				waitingSince: 10_000,
				latestEvent: "agent_end",
			},
			10_000,
		);

		const snapshot = classifyStatus(state, 240_000);
		assert.equal(snapshot.kind, "waiting");
		assert.equal(snapshot.waitingDurationText, "3m");
	});

	it("detects stalled transitions and recovery", () => {
		let state = createStatusState({ startTimeMs: 0 });
		state = observeStatus(state, { snapshot: "missing" }, 1_000);

		let advanced = advanceStatusState(state, 95_000);
		assert.equal(advanced.transition, "stalled");
		assert.equal(advanced.snapshot.kind, "stalled");

		state = observeStatus(
			advanced.nextState,
			{
				snapshot: "present",
				updatedAt: 96_000,
				sequence: 1,
				phase: "waiting",
				waitingSince: 96_000,
				latestEvent: "agent_end",
			},
			96_000,
		);
		advanced = advanceStatusState(state, 97_000);
		assert.equal(advanced.transition, "recovered");
		assert.equal(advanced.snapshot.kind, "waiting");
	});

	it("keeps the last healthy kind during transient snapshot loss", () => {
		let state = createStatusState({ startTimeMs: 0 });
		state = observeStatus(
			state,
			{
				snapshot: "present",
				updatedAt: 5_000,
				sequence: 1,
				phase: "active",
				active: true,
				activeScope: "streaming",
				activeSince: 5_000,
			},
			5_000,
		);
		state = advanceStatusState(state, 6_000).nextState;
		state = observeStatus(state, { snapshot: "missing" }, 10_000);

		const snapshot = classifyStatus(state, 20_000);
		assert.equal(snapshot.kind, "active");
		assert.equal(snapshot.statusLabel, null);
	});

	it("forces an active state to waiting after interrupt", () => {
		const now = 20_000;
		let state = createStatusState({ startTimeMs: 0 });
		state = observeStatus(
			state,
			{
				snapshot: "present",
				updatedAt: 5_000,
				sequence: 1,
				phase: "active",
				active: true,
				activeScope: "tool",
				activeSince: 5_000,
				activityLabel: "bash",
			},
			5_000,
		);

		assert.equal(classifyStatus(state, now).kind, "active");

		const forced = forceStatusAfterInterrupt(state, now);
		const snapshot = classifyStatus(forced, now);

		assert.equal(snapshot.kind, "waiting");
		assert.equal(snapshot.activityLabel, "interrupted");
		assert.equal(snapshot.waitingDurationText, "0s");
		assert.equal(forced.activeNow, false);
	});

	it("orders same-millisecond snapshots by sequence", () => {
		let state = createStatusState({ startTimeMs: 0 });
		state = observeStatus(
			state,
			{
				snapshot: "present",
				updatedAt: 10_000,
				sequence: 2,
				phase: "active",
				active: true,
				activeScope: "tool",
				activeSince: 10_000,
				activityLabel: "bash",
			},
			10_000,
		);

		state = observeStatus(
			state,
			{
				snapshot: "present",
				updatedAt: 10_000,
				sequence: 3,
				phase: "waiting",
				waitingSince: 10_000,
				latestEvent: "agent_end",
			},
			10_001,
		);

		const snapshot = classifyStatus(state, 11_000);
		assert.equal(snapshot.kind, "waiting");
		assert.equal(snapshot.latestEvent, "agent_end");
	});

	it("recovers from a transient snapshot read failure with the same valid snapshot", () => {
		let state = createStatusState({ startTimeMs: 0 });
		state = observeStatus(
			state,
			{
				snapshot: "present",
				updatedAt: 5_000,
				sequence: 2,
				phase: "active",
				active: true,
				activeScope: "tool",
				activeSince: 5_000,
				activityLabel: "bash",
			},
			5_000,
		);
		state = observeStatus(state, { snapshot: "missing" }, 10_000);
		assert.equal(classifyStatus(state, 10_000).statusLabel, null);

		state = observeStatus(
			state,
			{
				snapshot: "present",
				updatedAt: 5_000,
				sequence: 2,
				phase: "active",
				active: true,
				activeScope: "tool",
				activeSince: 5_000,
				activityLabel: "bash",
			},
			11_000,
		);

		const snapshot = classifyStatus(state, 11_000);
		assert.equal(snapshot.kind, "active");
		assert.equal(snapshot.statusLabel, null);
	});

	it("ignores stale and exact old snapshots after interrupt and accepts newer snapshots", () => {
		let state = createStatusState({ startTimeMs: 0 });
		state = observeStatus(
			state,
			{
				snapshot: "present",
				updatedAt: 5_000,
				sequence: 1,
				phase: "active",
				active: true,
				activeScope: "tool",
				activeSince: 5_000,
				activityLabel: "bash",
			},
			5_000,
		);
		state = forceStatusAfterInterrupt(state, 20_000);

		const stale = observeStatus(
			state,
			{
				snapshot: "present",
				updatedAt: 5_000,
				sequence: 1,
				phase: "active",
				active: true,
				activeScope: "tool",
				activeSince: 5_000,
				activityLabel: "bash",
			},
			21_000,
		);
		let snapshot = classifyStatus(stale, 21_000);
		assert.equal(snapshot.kind, "waiting");
		assert.equal(snapshot.activityLabel, "interrupted");

		const sameTimestamp = observeStatus(
			stale,
			{
				snapshot: "present",
				updatedAt: 20_000,
				sequence: 1,
				phase: "active",
				active: true,
				activeScope: "tool",
				activeSince: 20_000,
				activityLabel: "bash",
			},
			22_000,
		);
		snapshot = classifyStatus(sameTimestamp, 22_000);
		assert.equal(snapshot.kind, "waiting");
		assert.equal(snapshot.activityLabel, "interrupted");

		const resumed = observeStatus(
			sameTimestamp,
			{
				snapshot: "present",
				sequence: 2,
				updatedAt: 25_000,
				phase: "active",
				active: true,
				activeScope: "streaming",
				activeSince: 25_000,
				activityLabel: "streaming",
			},
			25_000,
		);
		snapshot = classifyStatus(resumed, 25_000);
		assert.equal(snapshot.kind, "active");
		assert.equal(resumed.activeScope, "streaming");
	});

	it("normalizes and truncates long newline-heavy names", () => {
		const longName = `Worker\n\n${"very-long-name-".repeat(12)}`;
		const stalledState = observeStatus(
			createStatusState({ startTimeMs: 0 }),
			{ snapshot: "missing" },
			1_000,
		);
		const activeState = observeStatus(
			createStatusState({ startTimeMs: 0 }),
			{
				snapshot: "present",
				updatedAt: 299_000,
				sequence: 1,
				phase: "active",
				active: true,
				activeScope: "tool",
				activeSince: 299_000,
				activityLabel: "write",
			},
			299_000,
		);
		const line = formatStatusLine(
			longName,
			classifyStatus(stalledState, 240_000),
		);
		const recovered = formatTransitionLine(
			longName,
			classifyStatus(activeState, 300_000),
			"recovered",
		);

		assert.doesNotMatch(line, /\n/);
		assert.doesNotMatch(recovered, /\n/);
		assert.ok(
			line.length <= 120,
			`expected bounded line length, got ${line.length}`,
		);
		assert.ok(
			recovered.length <= 120,
			`expected bounded line length, got ${recovered.length}`,
		);
	});

	it("caps visible status lines and reports overflow consistently", () => {
		const waitingState = observeStatus(
			createStatusState({ startTimeMs: 0 }),
			{
				snapshot: "present",
				updatedAt: 180_000,
				sequence: 1,
				phase: "waiting",
				waitingSince: 180_000,
			},
			180_000,
		);
		const activeState = observeStatus(
			createStatusState({ startTimeMs: 0 }),
			{
				snapshot: "present",
				updatedAt: 419_000,
				sequence: 1,
				phase: "active",
				active: true,
				activeScope: "tool",
				activeSince: 419_000,
				activityLabel: "bash",
			},
			419_000,
		);
		const waitingLine = formatStatusLine(
			"Worker",
			classifyStatus(waitingState, 300_000),
		);
		const recoveredLine = formatTransitionLine(
			"Worker",
			classifyStatus(activeState, 420_000),
			"recovered",
		);
		const lines = [
			waitingLine,
			recoveredLine,
			"Scout running 2m.",
			"Reviewer running 4m.",
			"Planner running 6m.",
		];
		const capped = capStatusLines(lines, 3);
		const aggregate = formatStatusAggregate(lines, 3);

		assert.equal(waitingLine, "Worker running 5m, waiting 2m.");
		assert.equal(
			recoveredLine,
			"Worker running 7m, recovered; active (bash 1s).",
		);
		assert.deepEqual(capped.visibleLines, [
			waitingLine,
			recoveredLine,
			"Scout running 2m.",
		]);
		assert.equal(capped.overflow, 2);
		assert.match(aggregate, /^Subagent status:/);
		assert.match(aggregate, /\+2 more running\./);
		assert.doesNotMatch(aggregate, /\/tmp|\.jsonl/);
	});
});

describe("shared subagent configuration path", () => {
	it("keeps the packaged example strict JSON without task preferences", () => {
		const example = JSON.parse(
			readFileSync(getSubagentsConfigExamplePath(), "utf8"),
		);
		assert.equal(example.models.tasks, undefined);
	});
});

describe("pane configuration", () => {
	it("defaults to four grouped panes when panes are absent", () => {
		assert.deepEqual(parsePaneConfig({}), {
			mode: "grouped",
			maxPerTab: 4,
			minSplitCols: 80,
			direction: "right",
		});
	});

	it("parses split mode and direction", () => {
		assert.deepEqual(
			parsePaneConfig({ panes: { mode: "split", direction: "down" } }),
			{ mode: "split", direction: "down", maxPerTab: 4, minSplitCols: 80 },
		);
	});

	it("loads a strict grouped capacity independently of persistent capacity", () => {
		withTempDir((dir) => {
			const config = join(dir, "config.json");
			writeFileSync(
				config,
				JSON.stringify({
					panes: { maxPerTab: 2 },
					persistent: { maxAgents: 9 },
				}),
			);
			assert.deepEqual(
				loadPaneConfig(dirname(config), getSubagentsConfigExamplePath()),
				{
					mode: "grouped",
					direction: "right",
					maxPerTab: 2,
					minSplitCols: 80,
				},
			);
			for (const maxPerTab of [
				0,
				-1,
				1.5,
				"4",
				null,
				true,
				Number.MAX_SAFE_INTEGER + 1,
			]) {
				writeFileSync(config, JSON.stringify({ panes: { maxPerTab } }));
				assert.throws(
					() =>
						loadPaneConfig(dirname(config), getSubagentsConfigExamplePath()),
					/panes.maxPerTab must be a positive safe integer/,
				);
			}
		});
	});

	it("rejects invalid pane settings", () => {
		for (const panes of [null, [], "split"]) {
			assert.throws(
				() => parsePaneConfig({ panes }),
				/panes must be an object/,
			);
		}
		assert.throws(
			() => parsePaneConfig({ panes: { mode: "window" } }),
			/panes\.mode must be "grouped", "tab", or "split"/,
		);
		assert.throws(
			() => parsePaneConfig({ panes: { direction: "left" } }),
			/panes\.direction must be "right" or "down"/,
		);
		assert.throws(
			() => parsePaneConfig({ panes: { mode: "tab", extra: true } }),
			/panes has unsupported key\(s\): extra/,
		);
	});

	it("loads the shared example when local config is absent", () => {
		withTempDir((dir) => {
			const examplePath = join(dir, "config.json.example");
			writeFileSync(
				examplePath,
				JSON.stringify({ panes: { mode: "split", direction: "down" } }),
			);

			assert.deepEqual(loadPaneConfig(dir, examplePath), {
				mode: "split",
				minSplitCols: 80,
				maxPerTab: 4,
				direction: "down",
			});
		});
	});

	it("uses tabs unchanged and passes split direction to the split creator", () => {
		const calls: string[] = [];
		const createTab = (name: string) => {
			calls.push(`tab:${name}`);
			return "tab-pane";
		};
		const createSplit = (name: string, direction: "right" | "down") => {
			calls.push(`split:${name}:${direction}`);
			return "split-pane";
		};

		assert.equal(
			createSubagentPaneFactory(
				{ mode: "tab", direction: "down", maxPerTab: 4 },
				createTab,
				createSplit,
			)("Scout"),
			"tab-pane",
		);
		assert.equal(
			createSubagentPaneFactory(
				{ mode: "split", direction: "right", maxPerTab: 4 },
				createTab,
				createSplit,
			)("Reviewer"),
			"split-pane",
		);
		assert.deepEqual(calls, ["tab:Scout", "split:Reviewer:right"]);
	});
});

describe("model configuration", () => {
	it("parses global and per-agent model defaults", () => {
		assert.deepEqual(
			parseModelConfig({
				models: {
					default: " anthropic/claude-sonnet-4-6 ",
					agents: { scout: " openai/gpt-5-mini " },
				},
			}),
			{
				default: "anthropic/claude-sonnet-4-6",
				agents: { scout: "openai/gpt-5-mini" },
			},
		);
	});

	it("loads no model overrides when config.json is absent", () => {
		const config = loadModelConfig(createTestDir());
		assert.deepEqual(config, { agents: {} });
	});

	it("resolves frontmatter, per-agent, global, and parent fallback precedence", () => {
		const config = parseModelConfig({
			models: {
				default: "fake/global",
				agents: { scout: "fake/scout" },
			},
		});

		assert.equal(
			resolveModelDefault("scout", "fake/frontmatter", config),
			"fake/frontmatter",
		);
		assert.equal(resolveModelDefault("scout", undefined, config), "fake/scout");
		assert.equal(
			resolveModelDefault("reviewer", undefined, config),
			"fake/global",
		);
		assert.equal(
			resolveModelDefault(undefined, undefined, { agents: {} }),
			undefined,
		);
	});

	it("does not read inherited object properties as agent model defaults", () => {
		const config = parseModelConfig({ models: { agents: {} } });
		for (const agent of ["constructor", "toString", "__proto__"]) {
			assert.equal(resolveModelDefault(agent, undefined, config), undefined);
		}
	});

	it("supports reserved property names when explicitly configured", () => {
		const config = parseModelConfig(
			JSON.parse(
				'{"models":{"agents":{"constructor":"fake/constructor","__proto__":"fake/proto"}}}',
			),
		);
		assert.equal(
			resolveModelDefault("constructor", undefined, config),
			"fake/constructor",
		);
		assert.equal(
			resolveModelDefault("__proto__", undefined, config),
			"fake/proto",
		);
	});

	it("parses strict task preferences and metadata", () => {
		assert.deepEqual(
			parseModelConfig({
				models: {
					tasks: { coding: ["fake/worker"] },
					tasksMeta: {
						generatedAt: "2026-09-17T00:00:00Z",
						method: "research",
					},
				},
			}),
			{
				agents: {},
				tasks: { coding: ["fake/worker"] },
				tasksMeta: {
					generatedAt: "2026-09-17T00:00:00Z",
					method: "research",
				},
			},
		);
		for (const config of [
			{ models: { tasks: { debugging: ["fake/worker"] } } },
			{ models: { tasks: { coding: [] } } },
			{ models: { tasks: { coding: [1] } } },
			{ models: { tasksMeta: { generatedAt: "nope", method: "guesswork" } } },
		]) {
			assert.throws(
				() => parseModelConfig(config),
				/models\.tasks|models\.tasksMeta/,
			);
		}
		for (const config of [
			{ models: { default: "task:coding" } },
			{ models: { agents: { worker: "task:coding" } } },
		]) {
			assert.throws(
				() => parseModelConfig(config),
				/only valid in the subagent tool's model parameter/,
			);
		}
		assert.deepEqual(parseModelConfig({ models: { tasks: {} } }), {
			agents: {},
		});
	});

	it("rejects exact duplicate task candidates after trimming without changing case-sensitive IDs", () => {
		assert.throws(
			() =>
				parseModelConfig({
					models: { tasks: { coding: [" fake/Worker ", "fake/Worker"] } },
				}),
			/models\.tasks\.coding.*duplicate.*fake\/Worker/,
		);
		assert.deepEqual(
			parseModelConfig({
				models: {
					tasks: { coding: [" fake/Worker ", "fake/worker", "proxy/Worker"] },
				},
			}).tasks,
			{ coding: ["fake/Worker", "fake/worker", "proxy/Worker"] },
		);
	});

	it("returns normalized saved preferences and missing categories after atomic replacement", () => {
		withTempDir((dir) => {
			const configPath = join(dir, "config.json");
			const tasksMeta = {
				generatedAt: "2026-09-18T00:00:00Z",
				method: "registry-only" as const,
			};
			const result = writeTaskModelConfig(
				configPath,
				getSubagentsConfigExamplePath(),
				{ coding: [" fake/worker "] },
				tasksMeta,
				(candidate) => candidate === "fake/worker",
			);
			assert.deepEqual(result, {
				configPath,
				tasks: { coding: ["fake/worker"] },
				tasksMeta,
				missingCategories: [
					"complex-coding",
					"review",
					"recon",
					"qa",
					"architecture",
					"docs",
				],
				configRevision: readConfigRevision(configPath),
			});
			const before = readFileSync(configPath, "utf8");
			assert.throws(
				() =>
					writeTaskModelConfig(
						configPath,
						getSubagentsConfigExamplePath(),
						{ coding: ["fake/worker", " fake/worker "] },
						tasksMeta,
						() => true,
					),
				/duplicate/,
			);
			assert.equal(readFileSync(configPath, "utf8"), before);
		});
	});

	it("seeds only required settings and keeps every config section loadable", () => {
		withTempDir((dir) => {
			const configPath = join(dir, "herdr-agents", "config.json");
			const examplePath = getSubagentsConfigExamplePath();
			writeTaskModelConfig(
				configPath,
				examplePath,
				{ coding: ["fake/worker"] },
				{ generatedAt: "2026-09-17T00:00:00Z", method: "research" },
				(candidate) => candidate === "fake/worker",
			);
			assert.equal(
				loadModelConfig(dirname(configPath)).tasks?.coding?.[0],
				"fake/worker",
			);
			assert.deepEqual(
				loadRoleConfig(dirname(configPath), examplePath).deprecations,
				[],
			);
			assert.equal(
				loadPaneConfig(dirname(configPath), examplePath).mode,
				"grouped",
			);
			assert.equal(
				loadSupervisionConfig(dirname(configPath), examplePath).forcePolling,
				false,
			);
			assert.equal(
				loadPersistentConfig(dirname(configPath), examplePath).maxAgents,
				3,
			);
			assert.equal(loadStatusConfig(configPath, examplePath).enabled, true);
		});
	});

	it("writes only validated task preferences into a seeded user config", () => {
		withTempDir((dir) => {
			const configPath = join(dir, "herdr-agents", "config.json");
			const examplePath = join(dir, "config.json.example");
			writeFileSync(
				examplePath,
				JSON.stringify({
					status: { enabled: true },
					roles: { bundled: false },
					models: { default: "fake/default" },
				}),
			);
			writeTaskModelConfig(
				configPath,
				examplePath,
				{ coding: ["fake/worker"] },
				{ generatedAt: "2026-09-17T00:00:00Z", method: "research" },
				(candidate) => candidate === "fake/worker",
			);
			assert.deepEqual(JSON.parse(readFileSync(configPath, "utf8")), {
				status: { enabled: true },
				models: {
					tasks: { coding: ["fake/worker"] },
					tasksMeta: {
						generatedAt: "2026-09-17T00:00:00Z",
						method: "research",
					},
				},
			});
			const before = readFileSync(configPath, "utf8");
			assert.throws(
				() =>
					writeTaskModelConfig(
						configPath,
						examplePath,
						{ coding: ["missing/model"] },
						{ generatedAt: "2026-09-17T00:00:00Z", method: "research" },
						() => false,
					),
				/missing\/model/,
			);
			assert.equal(readFileSync(configPath, "utf8"), before);
		});
	});

	it("repairs invalid existing task preferences without rewriting other model keys", () => {
		withTempDir((dir) => {
			const configPath = join(dir, "config.json");
			writeFileSync(
				configPath,
				JSON.stringify({
					status: { enabled: false },
					models: { default: "fake/default", tasks: { coding: null } },
				}),
			);
			writeTaskModelConfig(
				configPath,
				getSubagentsConfigExamplePath(),
				{ coding: ["fake/worker"] },
				{ generatedAt: "2026-09-17T00:00:00Z", method: "research" },
				(candidate) => candidate === "fake/worker",
			);
			assert.deepEqual(JSON.parse(readFileSync(configPath, "utf8")), {
				status: { enabled: false },
				models: {
					default: "fake/default",
					tasks: { coding: ["fake/worker"] },
					tasksMeta: {
						generatedAt: "2026-09-17T00:00:00Z",
						method: "research",
					},
				},
			});
		});
	});

	it("writes through an exclusive sibling temporary file before rename", () => {
		withTempDir((dir) => {
			const configPath = join(dir, "config.json");
			const writes: Array<{ path: string; options: unknown }> = [];
			const renames: Array<{ from: string; to: string }> = [];
			writeTaskModelConfig(
				configPath,
				getSubagentsConfigExamplePath(),
				{ coding: ["fake/worker"] },
				{ generatedAt: "2026-09-17T00:00:00Z", method: "research" },
				(candidate) => candidate === "fake/worker",
				{
					fileOperations: {
						writeFileSync(path, data, options) {
							writes.push({ path: String(path), options });
							writeFileSync(path, data, options);
						},
						renameSync(from, to) {
							renames.push({ from: String(from), to: String(to) });
							renameSync(from, to);
						},
					},
				},
			);
			assert.equal(writes.length, 1);
			assert.equal(dirname(writes[0].path), dirname(configPath));
			assert.match(writes[0].path, /-config\.tmp$/);
			assert.deepEqual(writes[0].options, { flag: "wx" });
			assert.deepEqual(renames, [{ from: writes[0].path, to: configPath }]);
			assert.equal(existsSync(writes[0].path), false);
		});
	});

	it("rejects invalid model configuration", () => {
		assert.throws(
			() => parseModelConfig({ models: { default: "" } }),
			/non-empty string/,
		);
		assert.throws(
			() => parseModelConfig({ models: { agents: [] } }),
			/must be an object/,
		);
		assert.throws(
			() => parseModelConfig({ models: { tasks: { debugging: ["fake/x"] } } }),
			/models\.tasks\.debugging.*supported categories: coding, complex-coding, review, recon, qa, architecture, docs/,
		);
		assert.throws(
			() => parseModelConfig({ models: { tasks: { coding: null } } }),
			/models\.tasks\.coding must be a non-empty list/,
		);
		assert.throws(
			() =>
				parseModelConfig({
					models: {
						tasksMeta: {
							generatedAt: "2026-09-17T00:00:00Z",
							method: "guesswork",
						},
					},
				}),
			/models\.tasksMeta\.method must be "research" or "registry-only"/,
		);
		assert.throws(
			() =>
				parseModelConfig({
					models: {
						tasksMeta: {
							generatedAt: "2026-09-17",
							method: "research",
						},
					},
				}),
			/models\.tasksMeta\.generatedAt must be an ISO-8601 string/,
		);
		assert.throws(
			() =>
				parseModelConfig({
					models: {
						tasksMeta: {
							generatedAt: "2026-09-17T00:00:00Z",
							method: "research",
							extra: true,
						},
					},
				}),
			/models\.tasksMeta has unsupported key\(s\): extra/,
		);
	});
});

describe("conditional task model config writes", () => {
	const tasksMeta = {
		generatedAt: "2026-10-05T00:00:00Z",
		method: "registry-only" as const,
	};

	const anyCandidate = () => true;

	const write = (
		configPath: string,
		tasks: Record<string, string[]>,
		options: Parameters<typeof writeTaskModelConfig>[5] = {},
	) =>
		writeTaskModelConfig(
			configPath,
			getSubagentsConfigExamplePath(),
			tasks,
			tasksMeta,
			anyCandidate,
			options,
		);

	const sha256 = (bytes: string | Buffer) =>
		`sha256:${createHash("sha256").update(bytes).digest("hex")}`;

	const assertWriteError = (run: () => void, code: string, pattern?: RegExp) =>
		assert.throws(run, (error: Error) => {
			assert.ok(error instanceof TaskModelConfigWriteError);
			assert.equal(error.code, code);
			if (pattern) assert.match(error.message, pattern);
			return true;
		});

	const siblings = (configPath: string) =>
		readdirSync(dirname(configPath)).sort();

	it("computes revisions over exact bytes, including whitespace, unrelated fields, and tasks", () => {
		withTempDir((dir) => {
			const configPath = join(dir, "config.json");
			assert.equal(readConfigRevision(configPath), "missing");
			const base = { keep: 1, models: { tasks: { coding: ["fake/a"] } } };
			const variants = [
				JSON.stringify(base),
				JSON.stringify(base, null, 2),
				JSON.stringify(base) + "\n",
				JSON.stringify({ ...base, keep: 2 }),
				JSON.stringify({ keep: 1, models: { tasks: { coding: ["fake/b"] } } }),
			];
			const revisions = variants.map((bytes) => {
				writeFileSync(configPath, bytes);
				const revision = readConfigRevision(configPath);
				assert.match(revision, /^sha256:[0-9a-f]{64}$/);
				assert.equal(revision, sha256(Buffer.from(bytes, "utf8")));
				assert.equal(revision, computeConfigRevision(readFileSync(configPath)));
				return revision;
			});
			assert.equal(new Set(revisions).size, variants.length);
		});
	});

	it("writes when the exact-byte revision matches and returns the saved file's revision", () => {
		withTempDir((dir) => {
			const configPath = join(dir, "config.json");
			writeFileSync(
				configPath,
				'{"keep":{"secret":"unrelated"},  "models":{"default":"fake/default","tasks":{"qa":["fake/qa"]}}}',
			);
			const saved = write(
				configPath,
				{ coding: ["fake/worker"], qa: ["fake/qa"] },
				{ expectedConfigRevision: readConfigRevision(configPath) },
			);
			const bytes = readFileSync(configPath);
			assert.equal(saved.configRevision, sha256(bytes));
			assert.equal(saved.configRevision, readConfigRevision(configPath));
			assert.deepEqual(JSON.parse(bytes.toString("utf8")), {
				keep: { secret: "unrelated" },
				models: {
					default: "fake/default",
					tasks: { coding: ["fake/worker"], qa: ["fake/qa"] },
					tasksMeta,
				},
			});
			assert.deepEqual(siblings(configPath), ["config.json"]);
			// The returned revision is a valid precondition for the next write.
			write(
				configPath,
				{ coding: ["fake/next"] },
				{ expectedConfigRevision: saved.configRevision },
			);
			assert.deepEqual(loadModelConfig(dir).tasks, { coding: ["fake/next"] });
		});
	});

	it("refuses stale revisions after task, unrelated-field, or whitespace-only changes without leaking content", () => {
		withTempDir((dir) => {
			const configPath = join(dir, "config.json");
			const original = JSON.stringify({
				keep: "secret-value-1",
				models: { tasks: { coding: ["fake/a"] } },
			});
			for (const changed of [
				JSON.stringify({
					keep: "secret-value-1",
					models: { tasks: { coding: ["fake/a"], qa: ["fake/qa"] } },
				}),
				JSON.stringify({
					keep: "secret-value-2",
					models: { tasks: { coding: ["fake/a"] } },
				}),
				JSON.stringify(JSON.parse(original), null, 2),
				original + "\n",
			]) {
				writeFileSync(configPath, original);
				const proposalRevision = readConfigRevision(configPath);
				writeFileSync(configPath, changed);
				assertWriteError(
					() =>
						write(
							configPath,
							{ coding: ["fake/new"] },
							{ expectedConfigRevision: proposalRevision },
						),
					"stale-revision",
					/bytes changed.*not replaced.*Re-read.*fresh proposal.*fresh approval/,
				);
				assert.throws(
					() =>
						write(
							configPath,
							{ coding: ["fake/new"] },
							{ expectedConfigRevision: proposalRevision },
						),
					(error: Error) => {
						assert.doesNotMatch(
							error.message,
							/secret-value|fake\/qa|fake\/a\b/,
						);
						assert.equal(
							error.message.includes(readConfigRevision(configPath)),
							false,
						);
						return true;
					},
				);
				assert.equal(readFileSync(configPath, "utf8"), changed);
				assert.deepEqual(siblings(configPath), ["config.json"]);
			}
		});
	});

	it("handles created, deleted, and missing config file states", () => {
		withTempDir((dir) => {
			const configPath = join(dir, "nested", "config.json");
			const saved = write(
				configPath,
				{ coding: ["fake/worker"] },
				{ expectedConfigRevision: "missing" },
			);
			// Missing-file writes seed only the required status setting and proposed models.
			const written = JSON.parse(readFileSync(configPath, "utf8"));
			assert.deepEqual(Object.keys(written), ["status", "models"]);
			assert.deepEqual(written.status, { enabled: true });
			assert.deepEqual(written.models.tasks, { coding: ["fake/worker"] });
			assert.equal(saved.configRevision, readConfigRevision(configPath));

			const existing = readFileSync(configPath, "utf8");
			assertWriteError(
				() =>
					write(
						configPath,
						{ coding: ["fake/other"] },
						{ expectedConfigRevision: "missing" },
					),
				"stale-revision",
				/expected no config file, but one now exists/,
			);
			assert.equal(readFileSync(configPath, "utf8"), existing);

			rmSync(configPath);
			assertWriteError(
				() =>
					write(
						configPath,
						{ coding: ["fake/other"] },
						{ expectedConfigRevision: saved.configRevision },
					),
				"stale-revision",
				/expected an existing config file, but it is now missing/,
			);
			assert.equal(existsSync(configPath), false);
			assert.deepEqual(readdirSync(dirname(configPath)), []);
		});
	});

	it("rejects invalid revision strings before reading or replacing configuration", () => {
		withTempDir((dir) => {
			const configPath = join(dir, "config.json");
			writeFileSync(configPath, "{}");
			const valid = readConfigRevision(configPath);
			for (const invalid of [
				"",
				null,
				42,
				"MISSING",
				" missing",
				valid.toUpperCase(),
				valid.replace("sha256:", "SHA256:"),
				valid.slice(0, -1),
				`${valid}0`,
				`${valid} `,
				valid.replace("sha256:", "sha1:"),
				valid.slice("sha256:".length),
			]) {
				assertWriteError(
					() =>
						write(
							configPath,
							{ coding: ["fake/worker"] },
							// SAFETY: deliberately bypasses static typing to test the runtime boundary.
							{ expectedConfigRevision: invalid as string },
						),
					"invalid-revision",
					/Invalid expectedConfigRevision/,
				);
				assert.equal(readFileSync(configPath, "utf8"), "{}");
				assert.deepEqual(siblings(configPath), ["config.json"]);
			}
		});
	});

	it("compares the revision before reporting malformed configuration and never replaces it", () => {
		withTempDir((dir) => {
			const configPath = join(dir, "config.json");
			for (const malformed of ["{not json", "[]", "null"]) {
				writeFileSync(configPath, malformed);
				assert.throws(
					() =>
						write(
							configPath,
							{ coding: ["fake/worker"] },
							{ expectedConfigRevision: readConfigRevision(configPath) },
						),
					/Invalid JSON in subagent config/,
				);
				assertWriteError(
					() =>
						write(
							configPath,
							{ coding: ["fake/worker"] },
							{ expectedConfigRevision: sha256("other") },
						),
					"stale-revision",
				);
				assert.throws(
					() => write(configPath, { coding: ["fake/worker"] }),
					/Invalid JSON in subagent config/,
				);
				assert.equal(readFileSync(configPath, "utf8"), malformed);
				assert.deepEqual(siblings(configPath), ["config.json"]);
			}
		});
	});

	it("keeps omitted revisions unconditional while preserving unrelated fields", () => {
		withTempDir((dir) => {
			const configPath = join(dir, "config.json");
			writeFileSync(
				configPath,
				JSON.stringify({
					keep: 1,
					models: {
						agents: { scout: "fake/scout" },
						tasks: { qa: ["fake/qa"] },
					},
				}),
			);
			const saved = write(configPath, { coding: ["fake/worker"] });
			assert.equal(saved.configRevision, readConfigRevision(configPath));
			// Unconditional writes still replace the full task map, as before.
			assert.deepEqual(JSON.parse(readFileSync(configPath, "utf8")), {
				keep: 1,
				models: {
					agents: { scout: "fake/scout" },
					tasks: { coding: ["fake/worker"] },
					tasksMeta,
				},
			});
		});
	});

	it("removes only its own temporary file and lock when publication fails", () => {
		withTempDir((dir) => {
			const configPath = join(dir, "config.json");
			writeFileSync(configPath, '{"keep":true}');
			const foreign = join(dir, ".foreign-config.tmp");
			writeFileSync(foreign, "not ours");
			for (const fileOperations of [
				{
					writeFileSync() {
						throw new Error("injected write failure");
					},
					renameSync,
				},
				{
					writeFileSync(path: any, data: any, options: any) {
						writeFileSync(path, data, options);
						throw new Error("injected write failure");
					},
					renameSync,
				},
				{
					writeFileSync,
					renameSync() {
						throw new Error("injected write failure");
					},
				},
			]) {
				assert.throws(
					() =>
						write(
							configPath,
							{ coding: ["fake/worker"] },
							{
								expectedConfigRevision: readConfigRevision(configPath),
								// SAFETY: test doubles implement only the injected call shape.
								fileOperations: fileOperations as any,
							},
						),
					/injected write failure/,
				);
				assert.equal(readFileSync(configPath, "utf8"), '{"keep":true}');
				assert.deepEqual(siblings(configPath), [
					".foreign-config.tmp",
					"config.json",
				]);
			}
			write(configPath, { coding: ["fake/worker"] });
			assert.deepEqual(siblings(configPath), [
				".foreign-config.tmp",
				"config.json",
			]);
		});
	});

	it("fails closed on held or stale locks and never removes another owner's lock", () => {
		withTempDir((dir) => {
			const configPath = join(dir, "config.json");
			writeFileSync(configPath, '{"keep":true}');
			const lockPath = getConfigWriteLockPath(configPath);
			const deadPid = spawnSync(process.execPath, ["-e", ""]).pid;
			for (const [contents, pattern] of [
				[
					JSON.stringify({
						pid: deadPid,
						hostname: hostname(),
						token: "other",
						createdAt: "2026-01-01T00:00:00.000Z",
					}),
					new RegExp(`pid ${deadPid}.*no longer running.*appears stale`),
				],
				[
					JSON.stringify({
						pid: process.pid,
						hostname: hostname(),
						token: "other",
					}),
					new RegExp(`pid ${process.pid}`),
				],
				["", /unidentified owner/],
				["{corrupt", /unidentified owner/],
			] as const) {
				writeFileSync(lockPath, contents);
				for (const expectedConfigRevision of [
					undefined,
					readConfigRevision(configPath),
				]) {
					assertWriteError(
						() =>
							write(
								configPath,
								{ coding: ["fake/worker"] },
								{ expectedConfigRevision },
							),
						"busy",
						pattern,
					);
					assertWriteError(
						() => write(configPath, { coding: ["fake/worker"] }),
						"busy",
						/never broken automatically/,
					);
				}
				assert.equal(readFileSync(lockPath, "utf8"), contents);
				assert.equal(readFileSync(configPath, "utf8"), '{"keep":true}');
				assert.deepEqual(siblings(configPath), [
					"config.json",
					"config.json.lock",
				]);
			}
			rmSync(lockPath);
			write(configPath, { coding: ["fake/worker"] });
			assert.deepEqual(siblings(configPath), ["config.json"]);
		});
	});

	it("serializes cooperating writers across processes and rejects the loser's stale revision", async () => {
		const dir = createTestDir();
		try {
			const configPath = join(dir, "config.json");
			writeFileSync(configPath, '{"keep":true}');
			const proposalRevision = readConfigRevision(configPath);
			const readyPath = join(dir, "ready");
			const releasePath = join(dir, "release");
			const moduleUrl = new URL(
				"../maestro/core/config/model-config.ts",
				import.meta.url,
			).href;
			const script = `
				import { existsSync, renameSync, writeFileSync } from "node:fs";
				import { writeTaskModelConfig } from ${JSON.stringify(moduleUrl)};
				const env = process.env;
				const sleeper = new Int32Array(new SharedArrayBuffer(4));
				const saved = writeTaskModelConfig(
					env.W2_CONFIG,
					env.W2_EXAMPLE,
					{ coding: ["fake/child"] },
					${JSON.stringify(tasksMeta)},
					() => true,
					{
						expectedConfigRevision: env.W2_REVISION,
						fileOperations: {
							renameSync,
							writeFileSync(path, data, options) {
								writeFileSync(env.W2_READY, "");
								const deadline = Date.now() + 20000;
								while (!existsSync(env.W2_RELEASE)) {
									if (Date.now() > deadline) throw new Error("release timeout");
									Atomics.wait(sleeper, 0, 0, 10);
								}
								writeFileSync(path, data, options);
							},
						},
					},
				);
				process.stdout.write(JSON.stringify(saved));
			`;
			const child = childProcess.spawn(
				process.execPath,
				["--experimental-strip-types", "--input-type=module", "-e", script],
				{
					env: {
						...process.env,
						W2_CONFIG: configPath,
						W2_EXAMPLE: getSubagentsConfigExamplePath(),
						W2_REVISION: proposalRevision,
						W2_READY: readyPath,
						W2_RELEASE: releasePath,
					},
					stdio: ["ignore", "pipe", "pipe"],
				},
			);
			let stdout = "";
			let stderr = "";
			child.stdout.on("data", (chunk) => (stdout += chunk));
			child.stderr.on("data", (chunk) => (stderr += chunk));
			const exited = new Promise<number | null>((resolve) =>
				child.on("close", resolve),
			);
			const readyDeadline = Date.now() + 20_000;
			while (!existsSync(readyPath)) {
				assert.ok(Date.now() < readyDeadline, `child never locked: ${stderr}`);
				await new Promise((resolve) => setTimeout(resolve, 10));
			}
			// The child holds the lock mid-publication: both kinds of parent write fail fast.
			for (const options of [{}, { expectedConfigRevision: proposalRevision }])
				assertWriteError(
					() => write(configPath, { qa: ["fake/parent"] }, options),
					"busy",
					new RegExp(`pid ${child.pid}`),
				);
			assert.equal(readFileSync(configPath, "utf8"), '{"keep":true}');
			writeFileSync(releasePath, "");
			assert.equal(await exited, 0, stderr);
			const saved = JSON.parse(stdout);
			assert.equal(saved.configRevision, readConfigRevision(configPath));
			assert.deepEqual(loadModelConfig(dir).tasks, { coding: ["fake/child"] });
			// The parent's proposal was read before the child's write; retrying it is stale.
			assertWriteError(
				() =>
					write(
						configPath,
						{ qa: ["fake/parent"] },
						{ expectedConfigRevision: proposalRevision },
					),
				"stale-revision",
			);
			assert.deepEqual(loadModelConfig(dir).tasks, { coding: ["fake/child"] });
			assert.deepEqual(readdirSync(dir).sort(), [
				"config.json",
				"ready",
				"release",
			]);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe("persistent specialist configuration", () => {
	it("defaults absent configuration to three specialists and rejects unknown keys", () => {
		assert.deepEqual(parsePersistentConfig({}), { maxAgents: 3 });
		assert.throws(
			() =>
				parsePersistentConfig({ persistent: { maxAgents: 3, extra: true } }),
			/persistent has unsupported key\(s\): extra/,
		);
		assert.throws(
			() => parsePersistentConfig({ persistent: { maxAgents: 0 } }),
			/persistent\.maxAgents must be a positive integer/,
		);
	});

	it("loads the shared example when local configuration is absent", () => {
		withTempDir((dir) => {
			const examplePath = join(dir, "config.json.example");
			writeFileSync(
				examplePath,
				JSON.stringify({ persistent: { maxAgents: 2 } }),
			);
			assert.deepEqual(loadPersistentConfig(dir, examplePath), {
				maxAgents: 2,
			});
		});
	});
});

describe("guidelines configuration", () => {
	it("defaults the launch roster on and accepts an explicit boolean", () => {
		assert.deepEqual(parseGuidelinesConfig({}), { launchRoster: true });
		assert.deepEqual(parseGuidelinesConfig({ guidelines: {} }), {
			launchRoster: true,
		});
		assert.deepEqual(
			parseGuidelinesConfig({ guidelines: { launchRoster: true } }),
			{ launchRoster: true },
		);
		assert.deepEqual(
			parseGuidelinesConfig({ guidelines: { launchRoster: false } }),
			{ launchRoster: false },
		);
	});

	it("rejects invalid launch roster values and unknown keys", () => {
		for (const value of ["false", 0, null, {}])
			assert.throws(
				() => parseGuidelinesConfig({ guidelines: { launchRoster: value } }),
				/Invalid subagent guidelines config in config\.json: guidelines\.launchRoster must be a boolean/,
			);
		assert.throws(
			() => parseGuidelinesConfig({ guidelines: false }),
			/guidelines must be an object/,
		);
		assert.throws(
			() => parseGuidelinesConfig({ guidelines: { roster: false } }),
			/guidelines has unsupported key\(s\): roster/,
		);
	});

	it("prefers config.json over the shared example", () => {
		const shippedExample = fileURLToPath(
			new URL("../config.json.example", import.meta.url),
		);
		withTempDir((dir) => {
			assert.deepEqual(loadGuidelinesConfig(dir, shippedExample), {
				launchRoster: true,
			});
		});
		withTempDir((dir) => {
			const examplePath = join(dir, "config.json.example");
			writeFileSync(
				examplePath,
				JSON.stringify({ guidelines: { launchRoster: false } }),
			);
			assert.deepEqual(loadGuidelinesConfig(dir, examplePath), {
				launchRoster: false,
			});
			writeFileSync(
				join(dir, "config.json"),
				JSON.stringify({ guidelines: { launchRoster: true } }),
			);
			assert.deepEqual(loadGuidelinesConfig(dir, examplePath), {
				launchRoster: true,
			});
			writeFileSync(
				join(dir, "config.json"),
				JSON.stringify({ guidelines: { launchRoster: "no" } }),
			);
			assert.throws(
				() => loadGuidelinesConfig(dir, examplePath),
				/guidelines\.launchRoster must be a boolean/,
			);
		});
	});
});

describe("supervision", () => {
	it("parses hang warning configuration strictly and loads the shared example", () => {
		assert.deepEqual(parseSupervisionConfig({}), {
			forcePolling: false,
			hangWarningMinutes: 15,
		});
		assert.deepEqual(
			parseSupervisionConfig({
				supervision: { forcePolling: true, hangWarningMinutes: 20 },
			}),
			{ forcePolling: true, hangWarningMinutes: 20 },
		);
		assert.deepEqual(
			parseSupervisionConfig({ supervision: { hangWarningMinutes: 0 } }),
			{ forcePolling: false, hangWarningMinutes: 0 },
		);
		for (const value of [-1, 1.5, "15"]) {
			assert.throws(
				() =>
					parseSupervisionConfig({
						supervision: { hangWarningMinutes: value },
					}),
				/supervision\.hangWarningMinutes must be a non-negative integer/,
			);
		}
		assert.throws(
			() => parseSupervisionConfig({ supervision: { extra: true } }),
			/supervision has unsupported key\(s\): extra/,
		);
		withTempDir((dir) => {
			const example = join(dir, "config.json.example");
			writeFileSync(
				example,
				JSON.stringify({ supervision: { hangWarningMinutes: 20 } }),
			);
			assert.deepEqual(loadSupervisionConfig(dir, example), {
				forcePolling: false,
				hangWarningMinutes: 20,
			});
		});
	});

	it("wakes every directory entry when fs.watch omits a filename", () => {
		let listener:
			| ((event: string, filename: string | Buffer | null) => void)
			| undefined;
		const watcher = {
			on() {
				return this;
			},
			close() {},
			unref() {
				return this;
			},
		};
		// SAFETY: The fake implements the fs.watch behavior used by FileWakeRegistry.
		const registry = new FileWakeRegistry(((
			_directory: string,
			callback: (event: string, filename: string | Buffer | null) => void,
		) => {
			listener = callback;
			return watcher;
		}) as any);
		let wakes = 0;
		const registration = registry.register(
			"/tmp/child.jsonl",
			() => {
				wakes += 1;
			},
			() => assert.fail("watcher unexpectedly fell back"),
		);
		listener?.("change", null);
		assert.equal(wakes, 1);
		registration.unregister();
		registry.close();
	});

	it("wakes on sidecar rename and releases registrations", async () => {
		const dir = createTestDir();
		const sessionFile = join(dir, "child.jsonl");
		let wakes = 0;
		const registry = new FileWakeRegistry();
		const registration = registry.register(
			sessionFile,
			() => {
				wakes += 1;
			},
			() => assert.fail("watcher unexpectedly fell back"),
		);
		try {
			const temporary = `${sessionFile}.exit.tmp`;
			writeFileSync(temporary, "{}");
			renameSync(temporary, `${sessionFile}.exit`);
			const deadline = Date.now() + 500;
			while (wakes === 0 && Date.now() < deadline)
				await new Promise((resolve) => setTimeout(resolve, 10));
			assert.equal(wakes, 1);
			registration.unregister();
			assert.equal(registry.watcherCount, 0);
		} finally {
			registry.close();
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("does not apply an in-flight snapshot to a child registered after it began", async () => {
		let resolveList:
			| ((snapshot: {
					complete: boolean;
					panes: Array<{
						paneId: string;
						workspaceId: string;
					}>;
			  }) => void)
			| undefined;
		let fallbackInspections = 0;
		const supervisor = new SupervisionCoordinator(
			() =>
				new Promise((resolve) => {
					resolveList = resolve;
				}),
			async () => {
				fallbackInspections += 1;
				return { kind: "present", agentStatus: "idle", observedAt: Date.now() };
			},
		);
		const dir = createTestDir();
		try {
			const one = supervisor.register(join(dir, "one.jsonl"), "one");
			const two = supervisor.register(join(dir, "two.jsonl"), "two");
			resolveList?.({
				complete: true,
				panes: [{ paneId: "one", workspaceId: "workspace" }],
			});
			await Promise.all([
				one.wait(new AbortController().signal),
				two.wait(new AbortController().signal),
			]);
			assert.equal((await two.inspectPane()).kind, "present");
			assert.equal(fallbackInspections, 1);
			one.unregister();
			two.unregister();
		} finally {
			supervisor.close();
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("confirms empty complete-list absence with a pane inspection", async () => {
		let fallbackInspections = 0;
		const supervisor = new SupervisionCoordinator(
			async () => ({ complete: true, panes: [] }),
			async () => {
				fallbackInspections += 1;
				return { kind: "present", agentStatus: "idle", observedAt: Date.now() };
			},
		);
		const dir = createTestDir();
		try {
			const registration = supervisor.register(
				join(dir, "child.jsonl"),
				"child",
			);
			await registration.wait(new AbortController().signal);
			assert.equal((await registration.inspectPane()).kind, "present");
			assert.equal(fallbackInspections, 1);
			registration.unregister();
		} finally {
			supervisor.close();
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("keeps watcherless entries on the legacy polling cadence", async () => {
		let fallbackInspections = 0;
		// SAFETY: This fake fs.watch always throws to model an unavailable watcher.
		const registry = new FileWakeRegistry((() => {
			throw new Error("watch unavailable");
		}) as any);
		const supervisor = new SupervisionCoordinator(
			async () => ({
				complete: true,
				panes: [{ paneId: "child", workspaceId: "workspace" }],
			}),
			async () => {
				fallbackInspections += 1;
				return { kind: "present", agentStatus: "idle", observedAt: Date.now() };
			},
			false,
			registry,
		);
		const dir = createTestDir();
		try {
			const registration = supervisor.register(
				join(dir, "child.jsonl"),
				"child",
			);
			await registration.wait(new AbortController().signal);
			assert.equal(supervisor.diagnostics().mode, "polling(fallback)");
			assert.equal((await registration.inspectPane()).kind, "present");
			await new Promise((resolve) => setImmediate(resolve));
			await registration.wait(new AbortController().signal);
			assert.equal((await registration.inspectPane()).kind, "present");
			const startedAt = Date.now();
			await registration.wait(new AbortController().signal);
			assert.ok(Date.now() - startedAt >= POLLING_INTERVAL_MS - 100);
			assert.equal((await registration.inspectPane()).kind, "present");
			assert.equal(fallbackInspections, 3);
			registration.unregister();
		} finally {
			supervisor.close();
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("clears the unhealthy batch retry when closed", async () => {
		const timeouts: Array<() => void> = [];
		const cleared: Array<() => void> = [];
		const tokens = new Map<ReturnType<typeof setTimeout>, () => void>();
		const timers = {
			setTimeout(callback: () => void) {
				timeouts.push(callback);
				// An inert, unref'd real timer is the opaque token handed back.
				const token = setTimeout(() => {}, 2 ** 31 - 1);
				token.unref();
				tokens.set(token, callback);
				return token;
			},
			clearTimeout(timer: ReturnType<typeof setTimeout>) {
				clearTimeout(timer);
				const callback = tokens.get(timer);
				assert.ok(callback, "clearTimeout receives a token it issued");
				cleared.push(callback);
			},
		};
		const supervisor = new SupervisionCoordinator(
			async () => {
				throw new Error("pane list unavailable");
			},
			async () => ({ kind: "unavailable" }),
			false,
			new FileWakeRegistry(),
			timers,
		);
		const registration = supervisor.register("/tmp/child.jsonl", "child");
		await new Promise((resolve) => setImmediate(resolve));
		supervisor.close();
		assert.equal(timeouts.length, 1);
		assert.deepEqual(cleared, timeouts);
		registration.unregister();
	});

	it("refuses malformed-list absence", async () => {
		for (const snapshot of [
			{ complete: false, panes: [] },
			{ complete: false, panes: [{ paneId: "one", workspaceId: "workspace" }] },
		]) {
			let fallbackInspections = 0;
			const supervisor = new SupervisionCoordinator(
				async () => snapshot,
				async () => {
					fallbackInspections += 1;
					return {
						kind: "present",
						agentStatus: "idle",
						observedAt: Date.now(),
					};
				},
			);
			const dir = createTestDir();
			try {
				const registration = supervisor.register(join(dir, "one.jsonl"), "one");
				await registration.wait(new AbortController().signal);
				assert.equal((await registration.inspectPane()).kind, "present");
				assert.equal(fallbackInspections, 1);
				registration.unregister();
			} finally {
				supervisor.close();
				rmSync(dir, { recursive: true, force: true });
			}
		}
	});

	it("keeps a queued reconciliation when a wake arrives before the next wait", async () => {
		let listener:
			| ((event: string, filename: string | Buffer | null) => void)
			| undefined;
		const watcher = {
			on() {
				return this;
			},
			close() {},
			unref() {
				return this;
			},
		};
		// SAFETY: The fake implements the fs.watch behavior used by FileWakeRegistry.
		const registry = new FileWakeRegistry(((
			_directory: string,
			callback: (event: string, filename: string | Buffer | null) => void,
		) => {
			listener = callback;
			return watcher;
		}) as any);
		const supervisor = new SupervisionCoordinator(
			async () => ({
				complete: true,
				panes: [{ paneId: "one", workspaceId: "workspace" }],
			}),
			async () => ({
				kind: "present",
				agentStatus: "idle",
				observedAt: Date.now(),
			}),
			false,
			registry,
		);
		try {
			const registration = supervisor.register("/tmp/child.jsonl", "one");
			// Let the registration-triggered reconciliation settle and queue its
			// pending "reconcile" reason before any waiter exists.
			await new Promise((resolve) => setImmediate(resolve));
			await new Promise((resolve) => setImmediate(resolve));
			listener?.("rename", null);
			assert.equal(
				await registration.wait(new AbortController().signal),
				"reconcile",
			);
			registration.unregister();
		} finally {
			supervisor.close();
		}
	});
});

describe("role configuration", () => {
	it("has no deprecations when the legacy key is omitted", () => {
		assert.deepEqual(parseRoleConfig({}), { deprecations: [] });
		assert.deepEqual(parseRoleConfig({ roles: {} }), { deprecations: [] });
	});

	it("accepts both legacy bundled booleans as deprecated no-ops", () => {
		for (const bundled of [true, false]) {
			const { deprecations } = parseRoleConfig(
				{ roles: { bundled } },
				"/agent/herdr-agents/config.json",
			);
			assert.equal(deprecations.length, 1);
			assert.match(
				deprecations[0],
				new RegExp(`roles\\.bundled \\(${bundled}\\).*is ignored`),
			);
			assert.match(deprecations[0], /\/agent\/herdr-agents\/config\.json/);
			assert.match(deprecations[0], /Install a role pack/);
			assert.match(deprecations[0], /The file was not changed/);
		}
	});

	it("rejects explicit null and non-object role settings", () => {
		for (const roles of [null, [], "roles"]) {
			assert.throws(
				() => parseRoleConfig({ roles }),
				/roles must be an object/,
			);
		}
		for (const bundled of [null, "false", [], 0]) {
			assert.throws(
				() => parseRoleConfig({ roles: { bundled } }),
				/roles\.bundled must be a boolean/,
			);
		}
		assert.throws(
			() => parseRoleConfig({ roles: { bundled: true, packs: [] } }),
			/roles has unsupported key\(s\): packs/,
		);
	});

	it("loads the shared example when local config is absent", () => {
		withTempDir((dir) => {
			const examplePath = join(dir, "config.json.example");
			writeFileSync(examplePath, JSON.stringify({ roles: { bundled: false } }));

			const { deprecations } = loadRoleConfig(dir, examplePath);
			assert.equal(deprecations.length, 1);
			assert.ok(deprecations[0].includes(examplePath));
		});
	});

	it("ships an example configuration without the legacy key", () => {
		const example = JSON.parse(
			readFileSync(getSubagentsConfigExamplePath(), "utf8"),
		);
		assert.equal(Object.hasOwn(example, "roles"), false);
	});

	it("rejects malformed bundled-role settings without falling back", () => {
		assert.throws(
			() => parseRoleConfig({ roles: { bundled: "false" } }),
			/roles\.bundled must be a boolean/,
		);
		withTempDir((dir) => {
			const configPath = join(dir, "config.json");
			const examplePath = join(dir, "config.json.example");
			const raw = JSON.stringify({ roles: { bundled: "false" } });
			writeFileSync(configPath, raw);
			writeFileSync(examplePath, JSON.stringify({ roles: { bundled: false } }));

			assert.throws(
				() => loadRoleConfig(dirname(configPath), examplePath),
				/roles\.bundled must be a boolean/,
			);
			assert.equal(readFileSync(configPath, "utf8"), raw);
		});
	});
});

describe("subagent-done.ts", () => {
	describe("auto-exit with launched children", () => {
		it("reads no children from a missing slot", () => {
			assert.equal(hasUndeliveredChildren({}), false);
		});

		it("counts a child row without a lifecycle as undelivered", () => {
			assert.equal(
				hasUndeliveredChildren({ runningSubagents: new Map([["legacy", {}]]) }),
				true,
				"an older runtime entry without lifecycle still holds its parent open",
			);
		});
	});
});

describe("lifecycle.ts", () => {
	const activity = (overrides: Partial<SubagentActivityState> = {}) => ({
		version: 1 as const,
		runningChildId: "child",
		createdAt: 1_000,
		updatedAt: 2_000,
		sequence: 1,
		latestEvent: "agent_start" as const,
		phase: "active" as const,
		agentActive: true,
		turnActive: true,
		providerActive: false,
		toolActive: false,
		activeScope: "agent" as const,
		activeSince: 2_000,
		...overrides,
	});

	it("interrupts only the turn and keeps process runtime open", () => {
		const running = observeLifecycleActivity(
			createLifecycle(1_000),
			{ ok: true, activity: activity() },
			2_000,
		);
		const interrupted = markInterruptRequested(running, 3_000);
		const projection = projectLifecycle(interrupted, 8_000);
		assert.equal(interrupted.process.kind, "running");
		assert.equal(interrupted.turn.kind, "interrupted");
		assert.equal(projection.runtimeEndedAt, undefined);
	});

	it("rejects stale activity after interrupt and accepts a newer sequence", () => {
		const running = observeLifecycleActivity(
			createLifecycle(1_000),
			{ ok: true, activity: activity() },
			2_000,
		);
		const interrupted = markInterruptRequested(running, 3_000);
		const stale = observeLifecycleActivity(
			interrupted,
			{ ok: true, activity: activity({ updatedAt: 3_000 }) },
			3_100,
		);
		assert.equal(stale.turn.kind, "interrupted");
		const resumed = observeLifecycleActivity(
			stale,
			{
				ok: true,
				activity: activity({
					updatedAt: 3_000,
					sequence: 2,
					activeSince: 3_000,
				}),
			},
			3_100,
		);
		assert.equal(resumed.turn.kind, "active");
	});

	it("makes finalizing and terminal process states irreversible", () => {
		const running = observeLifecycleActivity(
			createLifecycle(1_000),
			{ ok: true, activity: activity() },
			2_000,
		);
		const finalizing = markCompletionDetected(
			running,
			{ reason: "done", exitCode: 0 },
			4_000,
		);
		const ignored = observeLifecycleActivity(
			finalizing,
			{
				ok: true,
				activity: activity({ updatedAt: 5_000, sequence: 9 }),
			},
			5_000,
		);
		assert.equal(ignored.process.kind, "finalizing");
		assert.deepEqual(projectLifecycle(ignored, 9_000), {
			kind: "finalizing",
			runtimeEndedAt: 4_000,
		});
		const completed = markCompleted(ignored, 6_000);
		assert.equal(
			markFailed(completed, "late failure", 7_000).process.kind,
			"completed",
		);
	});

	it("projects confirmed running without turn detail as running, not starting", () => {
		const started = createLifecycle(1_000);
		const running = {
			...started,
			process: {
				kind: "running" as const,
				startedAt: 1_000,
				confirmedAt: 1_500,
			},
		};
		assert.deepEqual(projectLifecycle(running, 3_000), { kind: "running" });
	});

	it("detects stalled and recovered transitions from lifecycle projections", () => {
		assert.equal(lifecycleTransition("active", "stalled"), "stalled");
		assert.equal(lifecycleTransition("stalled", "waiting"), "recovered");
		assert.equal(lifecycleTransition("stalled", "active"), "recovered");
		assert.equal(lifecycleTransition("stalled", "blocked"), "recovered");
		assert.equal(lifecycleTransition("stalled", "interrupted"), "recovered");
		assert.equal(lifecycleTransition("waiting", "active"), null);
	});

	it("does not interpret initial idle as completion", () => {
		let lifecycle = createLifecycle(1_000);
		lifecycle = observePaneInspection(
			lifecycle,
			{ kind: "present", observedAt: 2_000, agentStatus: "idle" },
			2_000,
		);
		assert.equal(projectLifecycle(lifecycle, 3_000).kind, "starting");
		assert.equal(lifecycle.turn.kind, "starting");
	});

	it("treats working then idle as waiting", () => {
		let lifecycle = createLifecycle(1_000);
		lifecycle = observePaneInspection(
			lifecycle,
			{ kind: "present", observedAt: 2_000, agentStatus: "working" },
			2_000,
		);
		assert.equal(projectLifecycle(lifecycle, 2_500).kind, "active");
		lifecycle = observePaneInspection(
			lifecycle,
			{ kind: "present", observedAt: 3_000, agentStatus: "idle" },
			3_000,
		);
		assert.equal(projectLifecycle(lifecycle, 4_000).kind, "waiting");
	});

	it("preserves state entry time across repeated herdr observations", () => {
		let lifecycle = createLifecycle(1_000);
		lifecycle = observePaneInspection(
			lifecycle,
			{ kind: "present", observedAt: 2_000, agentStatus: "working" },
			2_000,
		);
		lifecycle = observePaneInspection(
			lifecycle,
			{ kind: "present", observedAt: 3_000, agentStatus: "working" },
			3_000,
		);
		assert.equal(projectLifecycle(lifecycle, 4_000).stateDurationSince, 2_000);

		lifecycle = observePaneInspection(
			lifecycle,
			{ kind: "present", observedAt: 5_000, agentStatus: "blocked" },
			5_000,
		);
		lifecycle = observePaneInspection(
			lifecycle,
			{ kind: "present", observedAt: 6_000, agentStatus: "blocked" },
			6_000,
		);
		assert.equal(projectLifecycle(lifecycle, 7_000).stateDurationSince, 5_000);

		lifecycle = observePaneInspection(
			lifecycle,
			{ kind: "present", observedAt: 8_000, agentStatus: "idle" },
			8_000,
		);
		lifecycle = observePaneInspection(
			lifecycle,
			{ kind: "present", observedAt: 9_000, agentStatus: "done" },
			9_000,
		);
		assert.equal(projectLifecycle(lifecycle, 10_000).stateDurationSince, 8_000);
	});

	it("does not enter finalizing from herdr idle/done", () => {
		let lifecycle = createLifecycle(1_000);
		lifecycle = observePaneInspection(
			lifecycle,
			{ kind: "present", observedAt: 2_000, agentStatus: "working" },
			2_000,
		);
		lifecycle = observePaneInspection(
			lifecycle,
			{ kind: "present", observedAt: 3_000, agentStatus: "done" },
			3_000,
		);
		assert.equal(lifecycle.process.kind, "running");
		assert.notEqual(projectLifecycle(lifecycle, 4_000).kind, "finalizing");
	});

	it("projects blocked when herdr reports blocked", () => {
		let lifecycle = createLifecycle(1_000);
		lifecycle = observePaneInspection(
			lifecycle,
			{ kind: "present", observedAt: 2_000, agentStatus: "blocked" },
			2_000,
		);
		assert.equal(projectLifecycle(lifecycle, 3_000).kind, "blocked");
	});

	it("treats missing pane as pane observation but not immediate failure", () => {
		let lifecycle = createLifecycle(1_000);
		lifecycle = observePaneInspection(
			lifecycle,
			{ kind: "present", observedAt: 2_000, agentStatus: "working" },
			2_000,
		);
		lifecycle = observePaneInspection(
			lifecycle,
			{ kind: "missing", error: "pane_not_found" },
			3_000,
		);
		assert.equal(lifecycle.pane.kind, "missing");
		assert.equal(lifecycle.process.kind, "running");
	});

	it("preserves local interrupt over stale herdr statuses", () => {
		for (const agentStatus of ["working", "blocked", "idle", "done"] as const) {
			let lifecycle = createLifecycle(1_000);
			lifecycle = observePaneInspection(
				lifecycle,
				{ kind: "present", observedAt: 2_000, agentStatus: "working" },
				2_000,
			);
			lifecycle = markInterruptRequested(lifecycle, 3_000);
			lifecycle = observePaneInspection(
				lifecycle,
				{ kind: "present", observedAt: 3_100, agentStatus },
				3_100,
			);
			assert.equal(
				projectLifecycle(lifecycle, 4_000).kind,
				"interrupted",
				agentStatus,
			);
		}
	});

	it("preserves hasWorked across unavailable observations", () => {
		let lifecycle = createLifecycle(1_000);
		lifecycle = observePaneInspection(
			lifecycle,
			{ kind: "present", observedAt: 2_000, agentStatus: "working" },
			2_000,
		);
		lifecycle = observePaneInspection(
			lifecycle,
			{ kind: "unavailable", error: "socket" },
			2_500,
		);
		lifecycle = observePaneInspection(
			lifecycle,
			{ kind: "unavailable", error: "socket" },
			2_600,
		);
		assert.equal(lifecycle.pane.kind, "read-error");
		assert.equal(
			lifecycle.pane.kind === "read-error"
				? lifecycle.pane.consecutiveFailures
				: 0,
			2,
		);
		lifecycle = observePaneInspection(
			lifecycle,
			{ kind: "present", observedAt: 3_000, agentStatus: "idle" },
			3_000,
		);
		assert.equal(projectLifecycle(lifecycle, 4_000).kind, "waiting");
	});

	it("does not let missing activity detail stall healthy herdr working", () => {
		let lifecycle = createLifecycle(1_000);
		lifecycle = observePaneInspection(
			lifecycle,
			{ kind: "present", observedAt: 2_000, agentStatus: "working" },
			2_000,
		);
		lifecycle = observeLifecycleActivity(
			lifecycle,
			{ ok: false, reason: "missing" },
			3_000,
		);
		assert.equal(projectLifecycle(lifecycle, 120_000).kind, "active");
	});

	it("uses activity as a fallback after a status-unknown pane snapshot", () => {
		let lifecycle = createLifecycle(1_000);
		lifecycle = observePaneInspection(
			lifecycle,
			{ kind: "present", observedAt: 2_000, agentStatus: "unknown" },
			2_000,
		);
		lifecycle = observeLifecycleActivity(
			lifecycle,
			{ ok: true, activity: activity() },
			2_000,
		);
		assert.equal(projectLifecycle(lifecycle, 3_000).kind, "active");
	});

	it("uses activity only as detail and does not override herdr waiting", () => {
		let lifecycle = createLifecycle(1_000);
		lifecycle = observePaneInspection(
			lifecycle,
			{ kind: "present", observedAt: 2_000, agentStatus: "working" },
			2_000,
		);
		lifecycle = observePaneInspection(
			lifecycle,
			{ kind: "present", observedAt: 3_000, agentStatus: "idle" },
			3_000,
		);
		lifecycle = observeLifecycleActivity(
			lifecycle,
			{ ok: true, activity: activity({ updatedAt: 3_100, sequence: 2 }) },
			3_100,
		);
		assert.equal(projectLifecycle(lifecycle, 4_000).kind, "waiting");
	});

	it("preserves activity detail duration across repeated updates", () => {
		let lifecycle = createLifecycle(1_000);
		lifecycle = observePaneInspection(
			lifecycle,
			{ kind: "present", observedAt: 2_000, agentStatus: "working" },
			2_000,
		);
		lifecycle = observeLifecycleActivity(
			lifecycle,
			{
				ok: true,
				activity: activity({
					updatedAt: 2_100,
					sequence: 1,
					activeSince: 2_000,
					activeScope: "tool",
					toolName: "bash",
					toolStartedAt: 2_000,
				}),
			},
			2_100,
		);
		lifecycle = observeLifecycleActivity(
			lifecycle,
			{
				ok: true,
				activity: activity({
					updatedAt: 3_000,
					sequence: 2,
					activeSince: 2_000,
					activeScope: "tool",
					toolName: "bash",
					toolStartedAt: 2_000,
				}),
			},
			3_000,
		);
		const projection = projectLifecycle(lifecycle, 4_000);
		assert.equal(projection.kind, "active");
		assert.equal(projection.label, "bash");
		assert.equal(projection.stateDurationSince, 2_000);
	});
});

describe("subagent activity snapshots", () => {
	function validActivity(overrides: any = {}) {
		return {
			version: 1,
			runningChildId: "child-1",
			createdAt: 1_000,
			updatedAt: 1_000,
			sequence: 1,
			latestEvent: "session_start",
			phase: "starting",
			agentActive: false,
			turnActive: false,
			providerActive: false,
			toolActive: false,
			...overrides,
		};
	}

	it("Task15 projects validated activity by reference, not as a parser", () => {
		assert.deepEqual(projectActivity(undefined), {
			ok: false,
			reason: "missing",
		});
		const state = validActivity();
		const read = projectActivity(state);
		assert.ok(read.ok);
		assert.equal(read.activity, state);
	});
});

describe("type guard aliases", () => {
	it("keeps both object predicate names equivalent", () => {
		assert.equal(isPlainObject({ value: true }), true);
		assert.equal(isRecord({ value: true }), true);
		assert.equal(isPlainObject(null), false);
	});
});

describe("parent messages are structured, not cut", () => {
	it("encodes U+061C and every other bidi control", () => {
		for (const char of [
			"\u061c",
			"\u200e",
			"\u200f",
			"\u202a",
			"\u202e",
			"\u2066",
			"\u2069",
		]) {
			const encoded = encodeHostValue(`a${char}b`);
			assert.equal(encoded.includes(char), false, JSON.stringify(encoded));
			assert.equal(
				encoded,
				`a\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}b`,
			);
		}
	});
});
