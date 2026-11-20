import "../clean-host-env.ts";
import "../isolated-agent-dir.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import { tmpdir } from "node:os";
import { MANAGED_WORKTREES_UNSUPPORTED_ON_WINDOWS } from "../../maestro/core/platform-support.ts";
import { FakeSurfaceProvider } from "../../maestro/surfaces/fake/fake-surface-provider.ts";
import { launchOperationsFromSurface } from "../../maestro/adapters/pi/launch-operations.ts";
import { SupervisionCoordinator } from "../../maestro/core/supervision.ts";
import { createDefaultRunSession } from "../../maestro/runtime/pi-run-session.ts";
import type { Role, Task } from "../../maestro/core/types.ts";

const escaped = (text: string) =>
	new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));

const worktreeRefusal = escaped(MANAGED_WORKTREES_UNSUPPORTED_ON_WINDOWS);

function recorded<A extends unknown[], R>(
	calls: string[],
	label: string,
	method: (...args: A) => R,
): (...args: A) => R {
	return (...args) => {
		calls.push(label);
		return method(...args);
	};
}

async function genericSpawn(platform: NodeJS.Platform) {
	const calls: string[] = [];
	const role: Role = {
		name: "worker",
		version: "1",
		description: "test",
		systemPrompt: "",
		allowedTools: [],
	};
	const reached = (name: string) => () => {
		calls.push(`worktree.${name}`);
		throw new Error(`fixture: worktree ${name} reached`);
	};
	const surfaceProvider = new FakeSurfaceProvider();
	surfaceProvider.createWorktreeSurface = recorded(
		calls,
		"herdr.createWorktreeSurface",
		surfaceProvider.createWorktreeSurface.bind(surfaceProvider),
	);
	const supervision = new SupervisionCoordinator(
		async () => ({ complete: true, panes: [] }),
		async () => ({ kind: "missing", observedAt: 0 }),
	);
	const session = createDefaultRunSession({
		configDir: "/unused",
		configExamplePath: "/unused/config.json.example",
		forcePolling: false,
		platform,
		roles: [role],
		infrastructure: {
			surfaceProvider,
			launchOperations: launchOperationsFromSurface(surfaceProvider, {
				mode: "tab",
				direction: "right",
				maxPerTab: 4,
			}),
			worktreeOperations: {
				resolveGitCommit: async () => reached("resolveGitCommit")(),
				resolveWorktreeProvisionCwd: async () =>
					reached("resolveWorktreeProvisionCwd")(),
				seedProjectPackages: async () => reached("seedProjectPackages")(),
				writeWorktreeManifest: reached("writeWorktreeManifest"),
				captureWorktreeHandoff: async () => reached("captureWorktreeHandoff")(),
				persistWorktreeResult: reached("persistWorktreeResult"),
			},
			supervision,
		},
		getLaunchSnapshot: () => {
			calls.push("launch.snapshot");
			throw new Error("fixture: launch snapshot read");
		},
		hooks: { onSettled() {} },
		persistent: {
			send: () => ({ error: "unused" }),
			stop: () => ({ error: "unused" }),
			drain() {},
		},
	});
	const task: Task = {
		id: `generic-${platform}`,
		name: "generic",
		role: role.name,
		prompt: "work",
		cwd: tmpdir(),
		worktree: { branch: "win-scope" },
	};
	try {
		return { calls, surfaceProvider, attempt: session.spawn(task) };
	} finally {
		supervision.close();
	}
}

test("win32: the generic run-session spawn refuses task.worktree before reading the launch snapshot", async () => {
	const f = await genericSpawn("win32");
	await assert.rejects(f.attempt, worktreeRefusal);
	assert.deepEqual(f.calls, []);
	assert.equal(f.surfaceProvider.listSurfaces().length, 0);
});

test("linux: the same generic spawn passes the platform guard and reads the launch snapshot", async () => {
	const f = await genericSpawn("linux");
	await assert.rejects(f.attempt, /fixture: launch snapshot read/);
	assert.deepEqual(f.calls, ["launch.snapshot"]);
});
