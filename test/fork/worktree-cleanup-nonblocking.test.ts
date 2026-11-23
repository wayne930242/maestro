import "../clean-host-env.ts";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
	chmodSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { describe, it } from "node:test";
import {
	listContainedWorktrees,
	removeContainedWorktree,
} from "../../maestro/core/worktree-cleanup.ts";
import { createWorktreeCleanupOperations } from "../../maestro/runtime/worktree-operations.ts";
import { FakeSurfaceProvider } from "../../maestro/surfaces/fake/fake-surface-provider.ts";
import { worktreesUnsupportedOnWindows } from "../helpers/windows-scope.ts";
import { cleanupFixture } from "../worktree-cleanup-fixture.ts";

/** Six managed checkouts t0..t5 whose cheap identity and Git state agree. */
function manyWorktrees() {
	const f = cleanupFixture();
	const paths = Array.from({ length: 6 }, (_, i) => `/managed/repo/t${i}`);
	const inspected: string[] = [];
	const held: string[] = [];
	const removed = new Set<string>();
	const branchOf = (path: string) => path.slice("/managed/repo/".length);
	f.operations.scan = () => paths.filter((path) => !removed.has(path));
	f.operations.exists = (path) => paths.includes(path) && !removed.has(path);
	f.operations.identify = (path) => ({
		branch: branchOf(path),
		sourceRepo: "/repo",
	});
	f.operations.inspectGit = (path) => {
		inspected.push(path);
		return { ...f.state, branch: branchOf(path) };
	};
	f.operations.holders = async (entry) => {
		held.push(entry.path);
		return { blockers: [], warnings: [] };
	};
	f.operations.removeCheckout = (source, path) => {
		f.calls.push(`git:${source}:${path}`);
		removed.add(path);
	};
	f.operations.prune = (source) => {
		f.calls.push(`prune:${source}`);
	};
	f.operations.removeWorkspace = (id) => {
		f.calls.push(`herdr:${id}`);
		removed.add(`/managed/repo/t${id.slice(1)}`);
	};
	return { ...f, paths, inspected, held };
}

describe("worktree removal inspects only the target", () => {
	it("resolves a branch target without inspecting the other worktrees", async () => {
		const f = manyWorktrees();
		const result = await removeContainedWorktree({ ...f.input, target: "t3" });
		assert.equal(result.status, "removed", result.message);
		assert.deepEqual(
			[...new Set(f.inspected)],
			["/managed/repo/t3"],
			"only the target is inspected (discovery and the fresh reinspection)",
		);
		assert.deepEqual([...new Set(f.held)], ["/managed/repo/t3"]);
		assert.deepEqual(f.calls, ["git:/repo:/managed/repo/t3", "prune:/repo"]);
	});

	it("resolves path and Herdr workspace targets the same way", async () => {
		const byPath = manyWorktrees();
		assert.equal(
			(
				await removeContainedWorktree({
					...byPath.input,
					target: "/managed/repo/t1",
				})
			).status,
			"removed",
		);
		assert.deepEqual([...new Set(byPath.inspected)], ["/managed/repo/t1"]);

		const byWorkspace = manyWorktrees();
		byWorkspace.operations.listWorktrees = () =>
			byWorkspace.paths.map((path, i) => ({
				path,
				branch: `t${i}`,
				isLinkedWorktree: true,
				workspaceId: `w${i}`,
			}));
		const result = await removeContainedWorktree({
			...byWorkspace.input,
			target: "w4",
		});
		assert.equal(result.status, "removed", result.message);
		assert.deepEqual([...new Set(byWorkspace.inspected)], ["/managed/repo/t4"]);
		assert.deepEqual(byWorkspace.calls, ["herdr:w4"]);
	});

	it("still inspects entries whose cheap identity is unknown", async () => {
		const f = manyWorktrees();
		const identify = f.operations.identify!;
		f.operations.identify = (path) =>
			path === "/managed/repo/t0" ? {} : identify(path);
		assert.equal(
			(await removeContainedWorktree({ ...f.input, target: "t3" })).status,
			"removed",
		);
		assert.deepEqual([...new Set(f.inspected)].sort(), [
			"/managed/repo/t0",
			"/managed/repo/t3",
		]);
		const missing = manyWorktrees();
		const notFound = await removeContainedWorktree({
			...missing.input,
			target: "absent",
		});
		assert.equal(notFound.status, "blocked");
		assert.match(notFound.message, /Target not found in managed inventory/);
		assert.deepEqual(missing.inspected, []);
	});
});

describe("worktree cleanup keeps the event loop responsive", () => {
	it("runs Git without blocking while listing and removing real worktrees", {
		skip: worktreesUnsupportedOnWindows,
	}, async () => {
		const root = realpathSync(mkdtempSync(join(tmpdir(), "cleanup-async-")));
		const saved = { ...process.env };
		const realGit = execFileSync("sh", ["-c", "command -v git"], {
			encoding: "utf8",
		}).trim();
		const run = (cwd: string, ...args: string[]) =>
			execFileSync(realGit, args, { cwd, stdio: "pipe" });
		try {
			writeFileSync(join(root, "gitconfig"), "");
			process.env.GIT_CONFIG_GLOBAL = join(root, "gitconfig");
			process.env.GIT_CONFIG_NOSYSTEM = "1";
			const source = join(root, "source");
			const managed = join(root, "managed");
			mkdirSync(source);
			run(source, "init", "-q", "-b", "main");
			run(source, "config", "user.name", "Cleanup test");
			run(source, "config", "user.email", "cleanup@example.invalid");
			run(source, "commit", "-q", "--allow-empty", "-m", "base");
			for (const name of ["alpha", "beta", "gamma"])
				run(
					source,
					"worktree",
					"add",
					"-q",
					"-b",
					name,
					join(managed, "repo", name),
				);
			run(
				source,
				"worktree",
				"add",
				"-q",
				"--detach",
				join(managed, "repo", "detached"),
			);
			// A slow `git status` exposes any synchronous Git call as a stall.
			const bin = join(root, "bin");
			const log = join(root, "git.log");
			mkdirSync(bin);
			writeFileSync(
				join(bin, "git"),
				`#!/bin/sh\nprintf '%s\\n' "$PWD" >> '${log}'\n[ "$1" = status ] && sleep 0.4\nexec '${realGit}' "$@"\n`,
			);
			chmodSync(join(bin, "git"), 0o755);
			process.env.PATH = `${bin}${delimiter}${process.env.PATH}`;
			const operations = createWorktreeCleanupOperations(
				new FakeSurfaceProvider(),
				{
					managedRoot: managed,
					manifestDir: join(root, "manifests"),
					liveHolders: () => [],
				},
			);
			const responsiveness = async <T>(work: () => Promise<T>) => {
				let last = performance.now();
				let maxGap = 0;
				const timer = setInterval(() => {
					const now = performance.now();
					maxGap = Math.max(maxGap, now - last);
					last = now;
				}, 5);
				try {
					const value = await work();
					maxGap = Math.max(maxGap, performance.now() - last);
					return { value, maxGap };
				} finally {
					clearInterval(timer);
				}
			};

			const listed = await responsiveness(() =>
				listContainedWorktrees({ cwd: source, operations }),
			);
			assert.equal(listed.value.length, 4);
			assert.ok(
				listed.maxGap < 300,
				`event loop stalled ${Math.round(listed.maxGap)}ms while listing`,
			);

			writeFileSync(log, "");
			const removed = await responsiveness(() =>
				removeContainedWorktree({ cwd: source, operations, target: "beta" }),
			);
			assert.equal(removed.value.status, "removed", removed.value.message);
			assert.ok(
				removed.maxGap < 300,
				`event loop stalled ${Math.round(removed.maxGap)}ms while removing`,
			);
			const touched = new Set(
				readFileSync(log, "utf8").split("\n").filter(Boolean),
			);
			assert.ok(touched.has(join(managed, "repo", "beta")), "the shim logs");
			for (const other of ["alpha", "gamma", "detached"])
				assert.equal(
					touched.has(join(managed, "repo", other)),
					false,
					`removal ran Git inside ${other}: ${[...touched].join(", ")}`,
				);
			assert.equal(
				run(source, "branch", "--list", "beta").toString().trim(),
				"beta",
			);
		} finally {
			for (const key of Object.keys(process.env))
				if (!(key in saved)) delete process.env[key];
			Object.assign(process.env, saved);
			rmSync(root, { recursive: true, force: true });
		}
	});
});
