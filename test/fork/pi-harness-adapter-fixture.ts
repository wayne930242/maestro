// weihung fork: the pi-harness-adapter.test.ts fixture and its retained
// worktree kill helpers, exported for fork cases. The migrated file is pinned
// by test identity, so fork cases live in test/fork/ and share this copy.
import "../clean-host-env.ts";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PiHarnessAdapter } from "../../maestro/adapters/pi/pi-harness-adapter.ts";
import { launchOperationsFromSurface } from "../../maestro/adapters/pi/launch-operations.ts";
import type {
	PiProcessIdentity,
	ProcessIdentityProbe,
	ProcessStat,
} from "../../maestro/adapters/pi/process-identity.ts";
import { FakeSurfaceProvider } from "../../maestro/surfaces/fake/fake-surface-provider.ts";
import { FileWakeRegistry } from "../../maestro/core/wake.ts";
import { SupervisionCoordinator } from "../../maestro/core/supervision.ts";
import type { SpawnOptions } from "../../maestro/core/harness-adapter.ts";

export const paneConfig = {
	mode: "grouped",
	direction: "right",
	maxPerTab: 4,
} as const;

export function fixture() {
	const root = mkdtempSync(join(tmpdir(), "pi-adapter-test-"));
	const sessionDir = join(root, "parent");
	mkdirSync(sessionDir);
	const sessionFile = join(sessionDir, "parent.jsonl");
	writeFileSync(
		sessionFile,
		JSON.stringify({ type: "session", version: 3, id: "parent", cwd: root }) +
			"\n",
	);
	const surface = new FakeSurfaceProvider();
	// Fake only the process launch. Session policy, artifact creation and completion are real.
	const operations = launchOperationsFromSurface(surface, paneConfig);
	operations.runScript = (_surface, _command, options) => options.scriptPath;
	const wake = new FileWakeRegistry();
	const supervision = new SupervisionCoordinator(
		async () => ({
			complete: true,
			panes: surface
				.listSurfaces()
				.map((s) => ({ paneId: s.id, workspaceId: "fixture" })),
		}),
		(id) => surface.inspectSurface(id),
		false,
		wake,
	);
	const modelRegistry = {
		find: (provider: string, id: string) => ({ provider, id, reasoning: true }),
		available: () => [],
		hasConfiguredAuth: () => true,
		supportedThinkingLevels:
			(): import("../../maestro/core/types.ts").ThinkingLevel[] => [
				"off",
				"minimal",
				"low",
				"medium",
				"high",
			],
		clampThinkingLevel: (
			_model: import("../../maestro/core/routing.ts").RoutingModel,
			level: import("../../maestro/core/types.ts").ThinkingLevel,
		) => level,
	};
	const adapter = new PiHarnessAdapter({
		surface,
		paneConfig,
		operations,
		wake,
		supervision,
		modelRegistry,
		parent: {
			cwd: root,
			sessionFile,
			sessionId: "parent",
			sessionDir,
			agentDir: join(root, "agent"),
		},
		parentRuntime: { provider: "fake", modelId: "test", thinking: "off" },
	});
	const options: SpawnOptions = {
		name: "worker",
		task: "bounded task",
		cwd: root,
		sessionId: "logical-task",
		role: {
			name: "worker",
			version: "1",
			description: "test",
			systemPrompt: "Focused identity",
			allowedTools: ["read", "bash"],
			defaults: { autoExit: true, spawning: false },
		},
		runtime: { model: "fake/test", thinking: "off" },
	};
	return {
		root,
		modelRegistry,
		adapter,
		surface,
		options,
		operations,
		wake,
		supervision,
		dispose() {
			supervision.close();
			wake.close();
			rmSync(root, { recursive: true, force: true });
		},
	};
}

export async function usingFixture(
	run: (f: ReturnType<typeof fixture>) => Promise<void>,
) {
	const f = fixture();
	try {
		await run(f);
	} finally {
		f.dispose();
	}
}

export const HOST = { bootId: "boot-a", pidNamespace: "pid:[4026531836]" };
export const identity = (overrides: Partial<PiProcessIdentity> = {}) => ({
	pid: 20,
	startTime: "5000",
	...HOST,
	...overrides,
});
export type Entry = ProcessStat | "EACCES" | undefined;
// A kernel process table keyed by PID. `terminate` runs `onTerminate`.
export function fakeProbe(
	table: Map<number, Entry>,
	onTerminate: (pid: number) => void = (pid) => table.delete(pid),
) {
	const signals: number[] = [];
	const probe: ProcessIdentityProbe = {
		host: () => HOST,
		stat(pid) {
			const entry = table.get(pid);
			if (entry === "EACCES")
				throw Object.assign(new Error(`EACCES: /proc/${pid}/stat`), {
					code: "EACCES",
				});
			return entry;
		},
		terminate(pid) {
			signals.push(pid);
			onTerminate(pid);
		},
	};
	return { probe, signals };
}
export const alive = (startTime = "5000"): ProcessStat => ({
	state: "S",
	ppid: 10,
	startTime,
});
export async function worktreeChild(
	f: ReturnType<typeof fixture>,
	options: {
		probe?: ProcessIdentityProbe;
		identity?: PiProcessIdentity;
		capture?: Promise<PiProcessIdentity | undefined>;
		captureError?: string;
		killTimeoutMs?: number;
	} = {},
) {
	const adapter = new PiHarnessAdapter({
		surface: f.surface,
		paneConfig,
		operations: f.operations,
		supervision: f.supervision,
		modelRegistry: f.modelRegistry,
		parent: {
			cwd: f.root,
			sessionFile: join(f.root, "parent", "parent.jsonl"),
			sessionId: "parent",
			sessionDir: join(f.root, "parent"),
			agentDir: join(f.root, "agent"),
		},
		parentRuntime: { provider: "fake", modelId: "test", thinking: "off" },
		killTimeoutMs: options.killTimeoutMs ?? 150,
		processProbe: options.probe,
	});
	const h = await adapter.spawn(f.options);
	const child = adapter.getRunningChild(h);
	const path = join(f.root, "worktree");
	// Only the adapter's ownership of a worktree child matters to kill.
	child.worktree = {
		path,
		workspaceId: "owned-workspace",
		paneId: child.surface,
		branch: "cancel",
		baseRef: "HEAD",
		baseSha: "base",
		manifestFile: join(f.root, "manifest.json"),
	};
	child.processIdentity = options.identity;
	child.processIdentityCapture = options.capture;
	child.processIdentityError = options.captureError;
	const closes: string[] = [];
	f.surface.closeSurface = (id) => {
		closes.push(id);
	};
	// Herdr's foreground list is never evidence: show an owned-looking Pi
	// in every case so no result can depend on it.
	f.surface.getProcessInfo = () => ({
		shellPid: 10,
		foregroundProcessGroupId: 10,
		pids: [10],
		foregroundProcesses: [],
	});
	return { adapter, h, child, closes };
}
