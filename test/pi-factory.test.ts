import "./isolated-agent-dir.ts";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { createPiExtension } from "../pi-extension/subagents/extension.ts";
import type {
	PiPresentationHooks,
	PiToolRenderers,
} from "../pi-extension/subagents/presentation-hooks.ts";
import {
	getSubagentsConfigDir,
	getSubagentsConfigExamplePath,
} from "../pi-extension/subagents/config-path.ts";
import {
	readGlobalSlot,
	RUNTIME_KEY,
	STATUS_INTERVAL_KEY,
	WIDGET_INTERVAL_KEY,
	writeGlobalSlot,
	type SubagentRuntime,
} from "../pi-extension/subagents/state.ts";
import { FakeSurfaceProvider } from "../maestro/surfaces/fake/fake-surface-provider.ts";
import { launchOperationsFromSurface } from "../maestro/adapters/pi/launch-operations.ts";
import { SupervisionCoordinator } from "../maestro/core/supervision.ts";
import {
	createLifecycle,
	projectLifecycle,
} from "../maestro/core/lifecycle.ts";
import { createStatusState, observeStatus } from "../maestro/core/status.ts";
import {
	isNormalized,
	normalizeAdoptedRows,
	type AdoptedRow,
} from "../pi-extension/subagents/observation.ts";
import { gitBlob } from "../scripts/check-copy-fidelity.ts";
import { readTestMap, TEST_MAPS } from "../scripts/check-test-migration.ts";
import { createMockExtensionApi } from "./helpers/mock-extension-api.ts";
import { testHostSurface, testPresentation } from "./helpers/pi-extension.ts";

// Supplemental M4 tests (not migrated identities): the per-load factory and
// its presentation hooks, observed through the real createPiExtension.

const root = new URL("../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");

interface Registration {
	name: string;
	description?: string;
	parameters?: unknown;
}

async function quit(mock: ReturnType<typeof createMockExtensionApi>) {
	for (const handler of mock.eventHandlers.get("session_shutdown") ?? [])
		await handler({ reason: "quit" }, { ui: { setWidget() {} } });
}

/**
 * weihung fork: the fork changes some public tool descriptions and parameters
 * (solutionSpace, complex-coding, cancel wording). Their reviewed shape is the
 * fork's test/fixtures/tool-schema/current.json, which tool-schema.test.ts
 * checks against live registrations and the released schema for breakage.
 * Overlay only those two fields here; order, names, commands, shortcuts,
 * events and the test surface still match H1's pin exactly.
 */
function forkToolSchemas(
	tools: { name: string; description: string; parameters: unknown }[],
) {
	const snapshot: {
		tools: { name: string; description: string; parameters: unknown }[];
	} = JSON.parse(read("test/fixtures/tool-schema/current.json"));
	for (const tool of tools) {
		const fork = snapshot.tools.find((entry) => entry.name === tool.name);
		if (!fork) continue;
		tool.description = fork.description;
		tool.parameters = fork.parameters;
	}
}

function withEnv(values: Record<string, string>, run: () => Promise<void>) {
	const saved = new Map(
		Object.keys(values).map((key) => [key, process.env[key]]),
	);
	Object.assign(process.env, values);
	return run().finally(() => {
		for (const [key, value] of saved)
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
	});
}

test("the factory reproduces H1's pinned parent and child/deny-tool registrations, in order", async () => {
	// H1's own before/after pin of its terminal entry (host fixture, archived
	// at the copy pin). Message renderers come from the host's hook, so they
	// are compared in the local wrapper comparison instead.
	const archive = "provenance/upstream/test/fixtures/h1-contract.json";
	const tree: { files: { path: string; blob: string }[] } = JSON.parse(
		read("provenance/upstream-tree.json"),
	);
	assert.equal(
		gitBlob(Buffer.from(read(archive))),
		tree.files.find((file) => file.path === "test/fixtures/h1-contract.json")
			?.blob,
	);
	const pinned = JSON.parse(read(archive));
	for (const scope of ["parent", "child"] as const) {
		const env: Record<string, string> =
			scope === "child"
				? {
						PI_SUBAGENT_ID: "pin-child",
						PI_DENY_TOOLS: "subagent,subagent_resume",
					}
				: {};
		await withEnv(env, async () => {
			const extension = createPiExtension({
				hostSurface: testHostSurface,
				presentation: testPresentation,
			});
			const mock = createMockExtensionApi();
			extension(mock.api);
			try {
				const actual = JSON.parse(
					JSON.stringify({
						testSurface: Object.keys(extension.__test__).sort(),
						tools: mock.registeredTools.map((tool: Registration) => ({
							name: tool.name,
							description: tool.description,
							parameters: tool.parameters,
						})),
						commands: mock.registeredCommands.map((command: Registration) => ({
							name: command.name,
							description: command.description,
						})),
						shortcuts: mock.registeredShortcuts,
						events: [...mock.eventHandlers].map(([event, handlers]) => [
							event,
							handlers.length,
						]),
					}),
				);
				const {
					exports: _exports,
					renderers: _renderers,
					...expected
				} = pinned[scope];
				forkToolSchemas(expected.tools);
				assert.deepEqual(actual, expected, scope);
				// One registration per tool and command per load: no duplicates.
				const names = mock.registeredTools.map(
					(tool: Registration) => tool.name,
				);
				assert.equal(new Set(names).size, names.length);
			} finally {
				await quit(mock);
			}
		});
	}
});

test("presentation hooks: injected tool callbacks attach as before (subagents_list result only); message renderers register once, last", async () => {
	const calls: string[] = [];
	const marker = (name: string) => ({
		renderCall: () => {
			throw new Error(`${name} renderCall`);
		},
		renderResult: () => {
			throw new Error(`${name} renderResult`);
		},
	});
	const rendered = [
		"subagent",
		"subagent_resume",
		"subagent_interrupt",
		"subagent_cancel",
		"subagents_list",
	] as const;
	const markers = new Map<string, ReturnType<typeof marker>>(
		rendered.map((name) => [name, marker(name)]),
	);
	const toolRenderers: PiToolRenderers = Object.fromEntries(markers);
	const mock = createMockExtensionApi();
	const register = mock.api.registerTool.bind(mock.api);
	mock.api.registerTool = (tool: Registration) => {
		calls.push(`tool:${tool.name}`);
		register(tool);
	};
	const presentation: PiPresentationHooks = {
		...testPresentation,
		toolRenderers,
		registerMessageRenderers(pi) {
			assert.equal(pi, mock.api);
			calls.push("registerMessageRenderers");
		},
	};
	const extension = createPiExtension({
		hostSurface: testHostSurface,
		presentation,
	});
	extension(mock.api);
	try {
		assert.equal(calls.at(-1), "registerMessageRenderers");
		assert.equal(
			calls.filter((call) => call === "registerMessageRenderers").length,
			1,
		);
		// H1's pinned presentation fixture: subagents_list never had a call renderer.
		for (const tool of mock.registeredTools) {
			const own = markers.get(tool.name);
			assert.equal(
				tool.renderCall,
				tool.name === "subagents_list" ? undefined : own?.renderCall,
				tool.name,
			);
			assert.equal(tool.renderResult, own?.renderResult, tool.name);
		}
		assert.deepEqual(
			mock.registeredTools
				.filter((tool: { renderResult?: unknown }) => tool.renderResult)
				.map((tool: Registration) => tool.name)
				.sort(),
			[...rendered].sort(),
		);
	} finally {
		await quit(mock);
	}
});

test("each factory call disposes the previous load's presentation timers and reloads configuration", async () => {
	let fired = 0;
	const widget = setInterval(() => fired++, 1);
	const status = setInterval(() => fired++, 1);
	writeGlobalSlot(WIDGET_INTERVAL_KEY, widget);
	writeGlobalSlot(STATUS_INTERVAL_KEY, status);
	const seen: { enabled: boolean; hang: number }[] = [];
	const presentation: PiPresentationHooks = {
		...testPresentation,
		createWidgets(deps) {
			seen.push({
				enabled: deps.statusConfig.enabled,
				hang: deps.supervisionConfig.hangWarningMinutes,
			});
			return testPresentation.createWidgets(deps);
		},
	};
	const configDir = getSubagentsConfigDir();
	mkdirSync(configDir, { recursive: true });
	try {
		createPiExtension({ hostSurface: testHostSurface, presentation });
		assert.equal(readGlobalSlot(WIDGET_INTERVAL_KEY), null);
		assert.equal(readGlobalSlot(STATUS_INTERVAL_KEY), null);
		const before = fired;
		await new Promise((resolve) => setTimeout(resolve, 20));
		assert.equal(fired, before, "previous intervals were cleared");
		writeFileSync(
			join(configDir, "config.json"),
			JSON.stringify({
				status: { enabled: false },
				supervision: { hangWarningMinutes: 7 },
			}),
		);
		createPiExtension({ hostSurface: testHostSurface, presentation });
		assert.deepEqual(seen, [
			{ enabled: true, hang: 15 },
			{ enabled: false, hang: 7 },
		]);
	} finally {
		clearInterval(widget);
		clearInterval(status);
		rmSync(join(configDir, "config.json"), { force: true });
	}
});

test("a load adopts the reload-surviving runtime slot instead of replacing it", () => {
	const first = createPiExtension({
		hostSurface: testHostSurface,
		presentation: testPresentation,
	});
	const runtime = readGlobalSlot<SubagentRuntime>(RUNTIME_KEY);
	assert.ok(runtime);
	const second = createPiExtension({
		hostSurface: testHostSurface,
		presentation: testPresentation,
	});
	assert.equal(readGlobalSlot<SubagentRuntime>(RUNTIME_KEY), runtime);
	assert.equal(
		first.__test__.runningSubagents,
		second.__test__.runningSubagents,
	);
});

test("local evidence, ticks and refreshes leave presentation cold; other observations redraw (factory side of the retained widget case)", async () => {
	let redraws = 0;
	const presentation: PiPresentationHooks = {
		...testPresentation,
		createWidgets(deps) {
			return {
				...testPresentation.createWidgets(deps),
				updateWidget: () => void redraws++,
			};
		},
	};
	const surface = new FakeSurfaceProvider();
	const supervision = new SupervisionCoordinator(
		async () => ({ complete: true, panes: [] }),
		(id) => surface.inspectSurface(id),
	);
	const mock = createMockExtensionApi();
	try {
		createPiExtension({ hostSurface: testHostSurface, presentation })(
			mock.api,
			{
				infrastructure: {
					surfaceProvider: surface,
					launchOperations: launchOperationsFromSurface(surface, {
						mode: "grouped",
						direction: "right",
						maxPerTab: 4,
					}),
					supervision,
				},
			},
		);
		const runtime = readGlobalSlot<SubagentRuntime>(RUNTIME_KEY);
		assert.ok(runtime?.session);
		// createDefaultRunSession attaches its owner under this branded symbol.
		const owner = Object.getOwnPropertyDescriptor(
			runtime.session,
			Symbol.for("pi-herdr-agents/PiRunSession-owner"),
		)?.value;
		assert.ok(owner);
		const lifecycle = createLifecycle(Date.now());
		// onObserved reads only the activity fields this row carries.
		const row = { id: "row", lifecycle };
		const observation = {
			observedAt: Date.now(),
			lifecycle,
			projection: projectLifecycle(lifecycle, Date.now()),
		};
		for (const kind of ["local-evidence", "tick", "refresh"])
			owner.options.hooks.onObserved(row, { ...observation, kind });
		assert.equal(redraws, 0);
		owner.options.hooks.onObserved(row, { ...observation, kind: "pane" });
		assert.equal(redraws, 1);
	} finally {
		await quit(mock);
		supervision.close();
	}
});

test("the config example defaults to the package asset root and accepts an explicit one", () => {
	assert.equal(
		getSubagentsConfigExamplePath(),
		fileURLToPath(new URL("config.json.example", root)),
	);
	assert.equal(
		getSubagentsConfigExamplePath("/asset root/with spaces"),
		"/asset root/with spaces/config.json.example",
	);
});

test("every migrated unit entry scrubs the inherited Pi and Herdr environment first", () => {
	// Maestro's counterpart of the host's test-environment guard, which reads
	// the host's npm test script and stays upstream.
	const SCRUB =
		/^import "(\.\/|\.\.\/)(clean-host-env|isolated-agent-dir)\.ts";$/;
	const manifest: { maestro_unit_entries: string[] } = JSON.parse(
		read("provenance/test-manifest.json"),
	);
	const migrated = new Set(
		TEST_MAPS.flatMap((name) =>
			readTestMap(fileURLToPath(new URL(`provenance/${name}`, root))).files.map(
				(entry) => entry.destination,
			),
		),
	);
	const entries = manifest.maestro_unit_entries.filter(
		(entry) => migrated.has(entry) || entry.startsWith("test/pi-"),
	);
	assert.ok(entries.length > 50, entries.join("\n"));
	for (const file of entries) {
		const source = ts.createSourceFile(
			file,
			read(file),
			ts.ScriptTarget.Latest,
			true,
		);
		const first = source.statements.find(ts.isImportDeclaration);
		assert.match(first?.getText(source) ?? "", SCRUB, file);
	}
});

test("adopted legacy rows without a lifecycle are normalized in place (projection used by the retained widget)", () => {
	const legacy: AdoptedRow = {
		id: "legacy",
		name: "legacy",
		task: "",
		surface: "s1",
		startTime: 5_000,
		sessionFile: "sess1",
		statusState: observeStatus(
			createStatusState({ startTimeMs: 5_000 }),
			{
				snapshot: "present",
				updatedAt: 6_000,
				sequence: 1,
				phase: "done",
				latestEvent: "subagent_done",
			},
			6_000,
		),
		interactive: false,
		runtimePlan: undefined,
	};
	assert.equal(isNormalized(legacy), false);
	normalizeAdoptedRows([legacy]);
	assert.equal(isNormalized(legacy), true);
	// Legacy "done" activity is a finished turn, hydrated as waiting, not
	// completion evidence (the retained widget case renders this as "waiting").
	assert.equal(projectLifecycle(legacy.lifecycle!, 7_000).kind, "waiting");
	const adopted = legacy.lifecycle;
	normalizeAdoptedRows([legacy]);
	assert.equal(legacy.lifecycle, adopted, "an existing lifecycle is kept");
});

test("/worktree list in a child session lists the provider's worktrees with encoded values", async () => {
	const surface = new FakeSurfaceProvider();
	const supervision = new SupervisionCoordinator(
		async () => ({ complete: true, panes: [] }),
		(id) => surface.inspectSurface(id),
	);
	const mock = createMockExtensionApi();
	await withEnv({ PI_SUBAGENT_ID: "child-list" }, async () => {
		try {
			createPiExtension({
				hostSurface: testHostSurface,
				presentation: testPresentation,
			})(mock.api, {
				infrastructure: {
					surfaceProvider: surface,
					launchOperations: launchOperationsFromSurface(surface, {
						mode: "grouped",
						direction: "right",
						maxPerTab: 4,
					}),
					supervision,
				},
				platform: "linux",
			});
			const worktree = mock.registeredCommands.find(
				(command: Registration) => command.name === "worktree",
			);
			assert.ok(worktree);
			const notices: [string, string][] = [];
			const ctx = {
				cwd: "/repo",
				ui: {
					notify: (message: string, level: string) =>
						void notices.push([message, level]),
				},
			};
			await worktree.handler("list", ctx);
			assert.deepEqual(notices.at(-1), ["No worktrees found.", "info"]);
			surface.createWorktreeSurface({
				name: "w",
				cwd: "/repo",
				branch: "feat/\u2028x",
				base: "HEAD",
			});
			await worktree.handler("list", ctx);
			const [message, level] = notices.at(-1)!;
			assert.equal(level, "info");
			assert.match(message, /^feat\/\\u2028x — \/repo\/feat-/);
			assert.match(message, /\(fake-workspace-1\)$/);
		} finally {
			await quit(mock);
			supervision.close();
		}
	});
});
