import "./isolated-agent-dir.ts";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
	launchPiSubagent,
	type FreshPiLaunchRequest,
	type ResumePiLaunchRequest,
} from "../maestro/adapters/pi/launch.ts";
import {
	captureSurfacePiProcessIdentity,
	launchOperationsFromSurface,
	type PiLaunchOperations,
} from "../maestro/adapters/pi/launch-operations.ts";
import {
	createLinuxProcessProbe,
	readOwnProcessIdentity,
	readProcessIdentityRecord,
	writeProcessIdentityRecord,
} from "../maestro/adapters/pi/process-identity.ts";
import { writeSubagentSessionPolicy } from "../maestro/adapters/pi/session.ts";
import { recordProcessIdentity } from "../maestro/adapters/pi/child/protocol.ts";
import { PiHarnessAdapter } from "../maestro/adapters/pi/pi-harness-adapter.ts";
import {
	createWorktreeCleanupOperations,
	readWorktreeManifest,
	resolveGitCommit,
	writeWorktreeManifest,
} from "../maestro/runtime/worktree-operations.ts";
import { FakeSurfaceProvider } from "../maestro/surfaces/fake/fake-surface-provider.ts";
import type { NativeExecution } from "../maestro/core/surface-provider.ts";
import { FileWakeRegistry } from "../maestro/core/wake.ts";
import { SupervisionCoordinator } from "../maestro/core/supervision.ts";
import { worktreesUnsupportedOnWindows } from "./helpers/windows-scope.ts";

/**
 * Supplemental M3 tests for adapter paths upstream reaches through retained
 * Herdr/Core providers, the terminal child forwarder or the tool surface.
 */
const linux = process.platform === "linux";
const plan = {
	provider: "test",
	modelId: "one",
	model: "test/one",
	thinking: "high" as const,
	modelSource: "request" as const,
	thinkingSource: "parent" as const,
};

function scratch() {
	const root = realpathSync(mkdtempSync(join(tmpdir(), "pi-adapter-paths-")));
	const sessionDir = join(root, "sessions");
	mkdirSync(sessionDir);
	const parentFile = join(root, "parent.jsonl");
	writeFileSync(
		parentFile,
		JSON.stringify({ type: "session", version: 3, id: "parent", cwd: root }) +
			"\n",
	);
	return { root, sessionDir, parentFile };
}

function fresh(
	root: string,
	sessionDir: string,
	parentFile: string,
	extra: Partial<FreshPiLaunchRequest> = {},
): FreshPiLaunchRequest {
	return {
		kind: "fresh",
		id: "native",
		name: "Native worker",
		task: "bounded",
		cwd: root,
		parent: {
			cwd: root,
			sessionFile: parentFile,
			sessionId: "parent",
			sessionDir,
		},
		runtimePlan: plan,
		behavior: {
			deniedTools: [],
			autoExit: true,
			interactive: false,
			sessionMode: "standalone",
		},
		...extra,
	};
}

function nativeOperations(start: NativeExecution["start"]): PiLaunchOperations {
	return {
		nativeExecution: {
			start,
			inspect: async () => ({ kind: "live" }),
			terminate: async () => {},
		},
		createPane: () => assert.fail("native launches acquire no pane"),
		createWorktree: () => assert.fail("native launches acquire no worktree"),
		waitForShellReady: async () => {},
		runScript: () => assert.fail("native launches type no script"),
		closePane: () => assert.fail("native launches own no pane"),
	};
}

function sessionLines(cwd: string, model?: string): string {
	const entries: object[] = [
		{
			type: "session",
			version: 3,
			id: "resumable",
			cwd,
			timestamp: new Date(0).toISOString(),
		},
	];
	if (model) {
		const [provider, modelId] = model.split("/");
		entries.push({
			type: "model_change",
			id: "m1",
			parentId: null,
			timestamp: new Date(0).toISOString(),
			provider,
			modelId,
		});
	}
	return entries.map((entry) => JSON.stringify(entry)).join("\n") + "\n";
}

test("native execution refuses managed worktrees, handoffs and supplied panes before any resource exists", async () => {
	const { root, sessionDir, parentFile } = scratch();
	try {
		const operations = nativeOperations(async () => assert.fail("not started"));
		for (const extra of [
			{ worktree: { branch: "task" } },
			{ handoff: { leafId: "leaf" } },
			{ surface: "pane-1" },
		])
			await assert.rejects(
				launchPiSubagent(
					fresh(root, sessionDir, parentFile, extra),
					operations,
				),
				/^Error: Herdr Core supports ordinary native execution only; managed worktrees, handoffs and supplied panes are deferred$/,
			);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("a definite native start failure propagates unchanged for fresh and resumed launches", async () => {
	const { root, sessionDir, parentFile } = scratch();
	try {
		const operations = nativeOperations(async () => {
			throw new Error("core refused the execution");
		});
		await assert.rejects(
			launchPiSubagent(fresh(root, sessionDir, parentFile), operations),
			/^Error: core refused the execution$/,
		);
		const sessionFile = join(root, "resume.jsonl");
		writeFileSync(sessionFile, sessionLines(root));
		writeSubagentSessionPolicy(sessionFile, {
			owner: "public",
			deniedTools: [],
		});
		const resume: ResumePiLaunchRequest = {
			kind: "resume",
			id: "resume",
			name: "Resume worker",
			sessionFile,
			parent: { sessionId: "parent", sessionDir },
		};
		await assert.rejects(
			launchPiSubagent(resume, operations),
			/^Error: core refused the execution$/,
		);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("a scoped resume pins the stored in-scope model and refuses an unrecorded or out-of-scope one", async () => {
	const { root, sessionDir } = scratch();
	try {
		const commands: string[] = [];
		const operations = nativeOperations(async (input) => {
			commands.push(input.command);
			return "native-resume";
		});
		const resume = (sessionFile: string): ResumePiLaunchRequest => ({
			kind: "resume",
			id: "scoped",
			name: "Scoped worker",
			sessionFile,
			parent: { sessionId: "parent", sessionDir },
			modelScope: ["test/one"],
		});
		const file = (name: string, model?: string) => {
			const path = join(root, `${name}.jsonl`);
			writeFileSync(path, sessionLines(root, model));
			writeSubagentSessionPolicy(path, { owner: "public", deniedTools: [] });
			return path;
		};
		const pinned = await launchPiSubagent(
			resume(file("in", "test/one")),
			operations,
		);
		assert.equal(pinned.surface, "native-resume");
		assert.match(commands[0], /--model 'test\/one'|--model test\/one/);
		const unrecorded = file("none");
		await assert.rejects(
			launchPiSubagent(resume(unrecorded), operations),
			new RegExp(
				`^Error: Cannot resume ${unrecorded.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} in a scoped session: it records no model to check against the scope`,
			),
		);
		await assert.rejects(
			launchPiSubagent(resume(file("out", "test/two")), operations),
			/test\/two/,
		);
		assert.equal(commands.length, 1, "refusals start nothing");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("process identity capture keeps retrying a failing pane query until its deadline", async () => {
	const { root } = scratch();
	try {
		const file = join(root, "child.process.json");
		writeProcessIdentityRecord(file, {
			version: 1,
			id: "child",
			sessionFile: join(root, "child.jsonl"),
			pid: 1,
			startTime: "1",
			bootId: "boot",
			pidNamespace: "pid:[1]",
		});
		let queries = 0;
		await assert.rejects(
			captureSurfacePiProcessIdentity(
				{
					getProcessInfo: () => {
						queries++;
						throw new Error("pane query failed");
					},
				},
				"pane-1",
				{ file, id: "child", sessionFile: join(root, "child.jsonl") },
				{ timeoutMs: 60, intervalMs: 5 },
			),
			/pane query failed/,
		);
		assert(queries > 1, "a failed query is retried, never accepted");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("the child records its own process identity only with an id, session and record path", {
	skip: !linux,
}, () => {
	const { root } = scratch();
	try {
		const file = join(root, "record.json");
		const sessionFile = join(root, "child.jsonl");
		recordProcessIdentity(undefined, sessionFile, file);
		recordProcessIdentity("child", undefined, file);
		assert.equal(existsSync(file), false);
		recordProcessIdentity("child", sessionFile, file);
		const record = readProcessIdentityRecord(file);
		assert.equal(record?.id, "child");
		assert.equal(record?.sessionFile, sessionFile);
		assert.equal(record?.pid, process.pid);
		assert.deepEqual(
			{ ...readOwnProcessIdentity(), version: 1, id: "child", sessionFile },
			record,
		);
		// An unwritable record path leaves identity unrecorded rather than throwing.
		recordProcessIdentity("child", sessionFile, join(file, "nested"));
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("the Linux probe reads a live process's stat and terminates it with SIGTERM", {
	skip: !linux,
}, async () => {
	const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
		stdio: "ignore",
	});
	try {
		assert.ok(child.pid);
		const probe = createLinuxProcessProbe();
		const stat = probe.stat(child.pid);
		assert.ok(stat);
		assert.equal(stat.ppid, process.pid);
		const exited = new Promise((resolve) => child.once("exit", resolve));
		probe.terminate(child.pid);
		assert.equal(await exited, null);
		assert.equal(child.signalCode, "SIGTERM");
		const missing = createLinuxProcessProbe(() => {
			throw Object.assign(new Error("gone"), { code: "ENOENT" });
		});
		assert.equal(missing.stat(child.pid), undefined);
		const denied = createLinuxProcessProbe(() => {
			throw Object.assign(new Error("denied"), { code: "EACCES" });
		});
		assert.throws(() => denied.stat(child.pid!), /denied/);
	} finally {
		child.kill("SIGKILL");
	}
});

test("explicit session modes select the launch session: only fork delivers its task directly", async () => {
	const { root, sessionDir, parentFile } = scratch();
	const provider = new FakeSurfaceProvider();
	const operations = launchOperationsFromSurface(provider, {
		mode: "tab",
		direction: "right",
		maxPerTab: 4,
	});
	const commands: string[] = [];
	operations.runScript = (_surface, command, options) => {
		commands.push(command);
		return options.scriptPath;
	};
	const supervision = new SupervisionCoordinator(
		async () => ({ complete: true, panes: [] }),
		(id) => provider.inspectSurface(id),
		false,
		new FileWakeRegistry(),
	);
	const adapter = new PiHarnessAdapter({
		surface: provider,
		paneConfig: { mode: "tab", direction: "right", maxPerTab: 4 },
		modelRegistry: {
			find: (p, id) => ({ provider: p, id, reasoning: true }),
			available: () => [],
			hasConfiguredAuth: () => true,
			supportedThinkingLevels: () => ["off", "high"],
			clampThinkingLevel: (_model, level) => level,
		},
		parent: {
			cwd: root,
			sessionFile: parentFile,
			sessionId: "parent",
			sessionDir,
		},
		operations,
		supervision,
	});
	try {
		for (const mode of ["standalone", "lineage-only", "fork"] as const)
			await adapter.spawn({
				name: mode,
				task: "bounded",
				cwd: root,
				role: {
					name: "",
					version: "1",
					description: "fixture",
					systemPrompt: "",
					allowedTools: [],
				},
				sessionId: `${mode}-session`,
				resolvedLaunch: { runtimePlan: plan },
				session: { mode },
			});
		assert.equal(commands.length, 3);
		// A fork receives its task directly; other modes read a task artifact.
		const direct = commands.map((command) => !/'@[^']+\.md'/.test(command));
		assert.deepEqual(direct, [false, false, true]);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("cleanup operations inventory, inspect, preserve and remove real managed checkouts", {
	skip: worktreesUnsupportedOnWindows,
}, async () => {
	const root = realpathSync(mkdtempSync(join(tmpdir(), "pi-cleanup-ops-")));
	const source = join(root, "source");
	const managed = join(root, "managed");
	const manifests = join(root, "manifests");
	const alpha = join(managed, "repo", "alpha");
	const detached = join(managed, "repo", "detached");
	mkdirSync(source);
	const git = (cwd: string, args: string[]) =>
		execFileSync("git", args, { cwd, encoding: "utf8", stdio: "pipe" });
	try {
		git(source, ["init", "-q", "-b", "main"]);
		git(source, ["config", "user.name", "Cleanup test"]);
		git(source, ["config", "user.email", "cleanup@example.invalid"]);
		git(source, ["config", "commit.gpgsign", "false"]);
		writeFileSync(join(source, ".gitignore"), "ignored/\n");
		git(source, ["add", ".gitignore"]);
		git(source, ["commit", "-qm", "base"]);
		git(source, ["worktree", "add", "-q", "-b", "alpha", alpha]);
		git(source, ["worktree", "add", "-q", "--detach", detached]);
		git(source, ["worktree", "lock", detached]);
		// Unresolvable and escaping residue never enters the inventory.
		symlinkSync(join(root, "missing"), join(managed, "dangling"));
		symlinkSync(root, join(managed, "escape"));
		const live: { path: string; persistent?: boolean }[] = [];
		const entry = (path: string, branch?: string) => ({
			path,
			sourceRepo: source,
			branch,
			contained: true,
			manifest: [],
			classification: "unknown" as const,
			blockers: [],
			warnings: [],
		});
		const ops = createWorktreeCleanupOperations(new FakeSurfaceProvider(), {
			managedRoot: managed,
			manifestDir: manifests,
			liveHolders: () => live,
		});
		assert.deepEqual(ops.readManifests(), []);
		assert.deepEqual(ops.scan().sort(), [alpha, detached].sort());
		assert.equal(ops.managedRoot(), managed);
		assert.equal(await ops.resolveSource(alpha), source);

		writeFileSync(join(alpha, "dirty.txt"), "work\n");
		mkdirSync(join(alpha, "ignored"));
		writeFileSync(join(alpha, "ignored", "cache"), "");
		const state = await ops.inspectGit(alpha, source);
		assert.deepEqual(
			{ ...state, headSha: state.headSha.length },
			{
				branch: "alpha",
				headSha: 40,
				registered: true,
				locked: false,
				dirtyFiles: 1,
				untrackedFiles: 1,
				ignoredFiles: 1,
				conflicts: 0,
				submodules: false,
			},
		);
		const locked = await ops.inspectGit(detached, source);
		assert.equal(locked.branch, "");
		assert.equal(locked.locked, true);
		assert.equal(locked.registered, true);

		live.push({ path: alpha }, { path: alpha, persistent: true });
		const holders = await ops.holders(entry(alpha, "alpha"));
		assert.deepEqual(holders.blockers.slice(0, 2), [
			"Live child holds the worktree",
			"Persistent-specialist lease holds the worktree",
		]);

		const unreadable = await ops.holders(entry(join(root, "vanished")));
		assert.equal(unreadable.blockers.length, 1);
		assert.match(
			unreadable.blockers[0],
			/^Process inspection unavailable: .*ENOENT/,
			"a failed process inspection blocks instead of clearing the checkout",
		);
		await assert.rejects(
			resolveGitCommit(source, "no-such-ref"),
			/^Error: Git exited 128: /,
		);
		assert.equal(
			await resolveGitCommit(source, "main"),
			git(source, ["rev-parse", "main"]).trim(),
		);
		const before = state.headSha;
		const preserved = await ops.preserve(entry(alpha, "alpha"));
		assert.notEqual(preserved, before);
		assert.equal(
			git(alpha, ["log", "-1", "--format=%s"]).trim(),
			"WIP: preserve worktree before explicit cleanup",
		);
		const clean = git(alpha, ["rev-parse", "HEAD"]).trim();
		await assert.rejects(
			async () => ops.preserve(entry(alpha, "alpha")),
			/git commit/,
			"nothing to preserve fails without inventing a commit",
		);
		assert.equal(git(alpha, ["rev-parse", "HEAD"]).trim(), clean);
		await assert.rejects(
			async () => ops.preserve(entry(alpha, "renamed")),
			/^Error: Retained branch changed before preservation$/,
		);

		const manifest = join(manifests, "alpha.json");
		assert.throws(
			() => ops.writeManifest(manifest, { state: "removed" }),
			/Manifest ownership became unavailable/,
		);
		writeWorktreeManifest(manifest, {
			version: 1,
			kind: "worktree-run",
			owner: "pi-herdr-subagents",
			path: alpha,
			branch: "alpha",
			sourceRepo: source,
			state: "retained",
		});
		writeFileSync(join(manifests, "corrupt.json"), "{");
		assert.deepEqual(
			ops.readManifests().map((entry) => entry.file),
			[manifest],
		);
		await ops.removeCheckout(source, alpha);
		await ops.prune(source);
		assert.equal(ops.exists(alpha), false);
		assert.deepEqual(
			git(source, ["branch", "--list", "alpha"]).trim(),
			"alpha",
			"the preserved branch survives checkout removal",
		);
		ops.writeManifest(manifest, { state: "removed" });
		assert.equal(readWorktreeManifest(manifest)?.state, "removed");
		writeFileSync(manifest, "{");
		writeWorktreeManifest(manifest, {
			version: 1,
			kind: "worktree-run",
			owner: "pi-herdr-subagents",
			path: alpha,
			branch: "alpha",
			sourceRepo: source,
			state: "retained",
		});
		assert.equal(readWorktreeManifest(manifest)?.state, "retained");
		await assert.rejects(
			async () => ops.resolveSource(join(root, "missing")),
			/ENOENT|spawn/,
		);
		assert.equal(JSON.parse(readFileSync(manifest, "utf8")).path, alpha);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
