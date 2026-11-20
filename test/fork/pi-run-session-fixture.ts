// Fork-only copy of the pi-run-session.test.ts fixture. The migrated test file
// is pinned by test identity, so fork cases live in test/fork/ and share this.
import "../isolated-agent-dir.ts";
import assert from "node:assert/strict";
import {
	mkdtempSync,
	mkdirSync,
	writeFileSync,
	rmSync,
	existsSync,
	realpathSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import * as runtime from "../../maestro/runtime/index.ts";
import type {
	DefaultRunSessionOptions,
	PiLaunchInput,
	PiRunRecord,
	PiCompletedMetadata,
} from "../../maestro/runtime/pi-run-session-types.ts";
import { FakeSurfaceProvider } from "../../maestro/surfaces/fake/fake-surface-provider.ts";
import { launchOperationsFromSurface } from "../../maestro/adapters/pi/launch-operations.ts";
import { FileWakeRegistry } from "../../maestro/core/wake.ts";
import { SupervisionCoordinator } from "../../maestro/core/supervision.ts";

export const turn = () => new Promise<void>((resolve) => setImmediate(resolve));

export async function fixture(
	run: (f: Awaited<ReturnType<typeof makeFixture>>) => Promise<void>,
) {
	const f = await makeFixture();
	try {
		await run(f);
	} finally {
		await f.session.shutdown("quit");
		await turn();
		rmSync(f.dir, { recursive: true, force: true });
	}
}

export async function makeFixture() {
	const dir = realpathSync(mkdtempSync(join(tmpdir(), "pi-composition-")));
	const parent = join(dir, "parent.jsonl");
	writeFileSync(
		parent,
		JSON.stringify({ type: "session", version: 3, id: "parent", cwd: dir }) +
			"\n",
	);
	mkdirSync(join(dir, "sessions"));
	const provider = new FakeSurfaceProvider();
	const commands: string[] = [];
	const operations = launchOperationsFromSurface(provider, {
		mode: "tab",
		direction: "right",
		maxPerTab: 4,
	});
	operations.waitForShellReady = async () => {};
	operations.runScript = (_id, command, options) => {
		commands.push(command);
		return options.scriptPath;
	};
	const wake = new FileWakeRegistry();
	const coordinator = new SupervisionCoordinator(
		async () => ({
			complete: true,
			panes: provider
				.listSurfaces()
				.map((s) => ({ paneId: s.id, workspaceId: "fixture" })),
		}),
		(id) => provider.inspectSurface(id),
		false,
		wake,
	);
	let registrations = 0;
	const register = coordinator.register.bind(coordinator);
	coordinator.register = (...args) => {
		registrations++;
		return register(...args);
	};
	const settled: PiCompletedMetadata[] = [];
	let latest: PiRunRecord | undefined;
	const options: DefaultRunSessionOptions = {
		configDir: dir,
		configExamplePath: fileURLToPath(
			new URL("../../config.json.example", import.meta.url),
		),
		infrastructure: {
			surfaceProvider: provider,
			launchOperations: operations,
			supervision: coordinator,
		},
		forcePolling: false,
		roles: [],
		getLaunchSnapshot: () => ({
			parent: {
				cwd: dir,
				invocationCwd: dir,
				sessionFile: parent,
				sessionId: "parent",
				sessionDir: join(dir, "sessions"),
				agentDir: dir,
			},
			parentRuntime: { provider: "test", modelId: "one", thinking: "high" },
			paneConfig: { mode: "tab", direction: "right", maxPerTab: 4 },
			modelRegistry: {
				find: (p, id) => ({ provider: p, id, reasoning: true }),
				available: () => [],
				hasConfiguredAuth: () => true,
				supportedThinkingLevels: () => [
					"off",
					"minimal",
					"low",
					"medium",
					"high",
				],
				clampThinkingLevel: (_model, level) => level,
			},
		}),
		hooks: {
			onSpawned(record) {
				latest = record;
			},
			onSettled(_record, result) {
				settled.push(result);
			},
		},
		persistent: {
			send() {
				return { error: "test policy" };
			},
			stop() {
				return { error: "test policy" };
			},
			drain() {},
		},
	};
	assert.ok(
		runtime.createDefaultRunSession,
		"typed Pi composition must be exported as an implemented operation",
	);
	const session = runtime.createDefaultRunSession(options);
	function input(id = "control", persistent = false): PiLaunchInput {
		const plan = {
			provider: "test",
			modelId: "one",
			model: "test/one",
			thinking: "high" as const,
			modelSource: "request" as const,
			thinkingSource: "parent" as const,
		};
		return {
			task: {
				id,
				name: "child",
				prompt: "bounded",
				role: "",
				cwd: dir,
				behavior: { autoExit: !persistent, persistent },
			},
			role: {
				name: "",
				version: "1",
				description: "fixture",
				systemPrompt: "",
				allowedTools: [],
			},
			plans: [plan],
			resolved: {},
			identity: {
				id: `public-${id}`,
				logicalId: `logical-${id}`,
				generationId: `generation-${id}`,
				taskId: `inbox-${id}`,
			},
		};
	}
	function complete(
		record: PiRunRecord,
		result: {
			type: "done" | "error" | "ping";
			errorMessage?: string;
			name?: string;
			message?: string;
		} = { type: "done" },
	) {
		// Fake only process startup: emulate the real child's first session header.
		if (!existsSync(record.sessionFile))
			writeFileSync(
				record.sessionFile,
				JSON.stringify({
					type: "session",
					version: 3,
					id: record.id,
					cwd: dir,
				}) + "\n",
			);
		writeFileSync(`${record.sessionFile}.exit`, JSON.stringify(result));
	}
	return {
		dir,
		provider,
		operations,
		options,
		session,
		input,
		complete,
		commands,
		settled,
		latest: () => latest,
		registrations: () => registrations,
	};
}
