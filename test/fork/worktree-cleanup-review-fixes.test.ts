import "../clean-host-env.ts";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
	mkdirSync,
	mkdtempSync,
	realpathSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { removeContainedWorktree } from "../../maestro/core/worktree-cleanup.ts";
import { __worktreeCleanupTest__ } from "../../maestro/runtime/worktree-operations.ts";
import { worktreesUnsupportedOnWindows } from "../helpers/windows-scope.ts";
import { cleanupFixture } from "../worktree-cleanup-fixture.ts";

const { execFileText, identifyWorktree } = __worktreeCleanupTest__;

describe("execFileText keeps execFileSync's limits", () => {
	it("rejects at the timeout when a grandchild keeps the pipes open", {
		skip: process.platform === "win32",
	}, async () => {
		const started = performance.now();
		await assert.rejects(
			execFileText("sh", ["-c", "sleep 5 & echo done"], { timeoutMs: 1000 }),
			(error: NodeJS.ErrnoException) => {
				assert.equal(error.code, "ETIMEDOUT");
				assert.equal(error.message, "spawnSync sh ETIMEDOUT");
				return true;
			},
		);
		const elapsed = performance.now() - started;
		assert.ok(elapsed < 3000, `rejected after ${Math.round(elapsed)}ms`);
	});

	it("shares the 1 MiB output limit across stdout and stderr", {
		skip: process.platform === "win32",
	}, async () => {
		const script = "head -c 600000 /dev/zero; head -c 600000 /dev/zero >&2";
		await assert.rejects(
			execFileText("sh", ["-c", script], {}),
			(error: NodeJS.ErrnoException) => {
				assert.equal(error.code, "ENOBUFS");
				return true;
			},
		);
		assert.throws(
			() => execFileSync("sh", ["-c", script], { stdio: "pipe" }),
			(error: NodeJS.ErrnoException) => error.code === "ENOBUFS",
			"parity reference",
		);
	});
});

/** Six managed checkouts t0..t5 whose cheap identity names their branch. */
function many() {
	const f = cleanupFixture();
	const paths = Array.from({ length: 6 }, (_, i) => `/managed/repo/t${i}`);
	const inspected: string[] = [];
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
	const workspaces = () =>
		paths.map((path, i) => ({
			path,
			branch: `t${i}`,
			isLinkedWorktree: true,
			workspaceId: `w${i}`,
		}));
	return { ...f, inspected, workspaces };
}

describe("removal candidate selection", () => {
	it("skips a checkout whose source is out of scope", async () => {
		const f = many();
		const identify = f.operations.identify!;
		f.operations.identify = (path) =>
			path === "/managed/repo/t2"
				? { branch: "t2", sourceRepo: "/elsewhere" }
				: identify(path);
		f.operations.listWorktrees = f.workspaces;
		const result = await removeContainedWorktree({ ...f.input, target: "w3" });
		assert.equal(result.status, "removed", result.message);
		assert.equal(f.inspected.includes("/managed/repo/t2"), false);
	});

	it("inspects every in-scope checkout when Herdr's listing fails", async () => {
		const f = many();
		let calls = 0;
		f.operations.listWorktrees = () => {
			calls += 1;
			if (calls === 1) throw new Error("herdr down");
			return f.workspaces();
		};
		const result = await removeContainedWorktree({ ...f.input, target: "w3" });
		assert.equal(result.status, "removed", result.message);
		for (let i = 0; i < 6; i += 1)
			assert.ok(f.inspected.includes(`/managed/repo/t${i}`), `t${i}`);
	});

	it("inspects a checkout whose identify throws", async () => {
		const f = many();
		const identify = f.operations.identify!;
		f.operations.identify = (path) => {
			if (path === "/managed/repo/t0") throw new Error("unreadable");
			return identify(path);
		};
		const result = await removeContainedWorktree({ ...f.input, target: "t3" });
		assert.equal(result.status, "removed", result.message);
		assert.deepEqual([...new Set(f.inspected)].sort(), [
			"/managed/repo/t0",
			"/managed/repo/t3",
		]);
	});

	it("still refuses a branch that equals another checkout's workspace id", async () => {
		const f = many();
		f.operations.listWorktrees = () =>
			f.workspaces().map((row, i) => ({
				...row,
				workspaceId: i === 1 ? "t3" : row.workspaceId,
			}));
		const result = await removeContainedWorktree({ ...f.input, target: "t3" });
		assert.equal(result.status, "blocked");
		assert.match(result.message, /Ambiguous target/);
		assert.deepEqual(f.calls, []);
	});

	it("refuses that ambiguity when the workspace row's source hint is unknown", async () => {
		// Row t1 carries `[core] worktree = X` on the section-header line;
		// identify must report its source unknown, not out of scope.
		const f = many();
		const identify = f.operations.identify!;
		f.operations.identify = (path) =>
			path === "/managed/repo/t1" ? { branch: "t1" } : identify(path);
		f.operations.listWorktrees = () =>
			f.workspaces().map((row, i) => ({
				...row,
				workspaceId: i === 1 ? "t3" : row.workspaceId,
			}));
		const result = await removeContainedWorktree({ ...f.input, target: "t3" });
		assert.match(result.message, /Ambiguous target/);
		assert.deepEqual(f.calls, []);
	});
});

describe("identifyWorktree against real Git", {
	skip: worktreesUnsupportedOnWindows,
}, () => {
	let root: string;
	let source: string;
	let realGit: string;
	const saved = { ...process.env };
	const run = (cwd: string, ...args: string[]) =>
		execFileSync(realGit, args, { cwd, stdio: "pipe" }).toString();
	const fresh = (name: string) => {
		const repo = join(root, name);
		mkdirSync(repo);
		run(repo, "init", "-q", "-b", "main");
		run(repo, "commit", "-q", "--allow-empty", "-m", "base");
		return repo;
	};
	before(() => {
		root = realpathSync(mkdtempSync(join(tmpdir(), "identify-")));
		realGit = execFileSync("sh", ["-c", "command -v git"], {
			encoding: "utf8",
		}).trim();
		writeFileSync(
			join(root, "gitconfig"),
			'[user]\n\tname = t\n\temail = t@example.invalid\n[protocol "file"]\n\tallow = always\n',
		);
		process.env.GIT_CONFIG_GLOBAL = join(root, "gitconfig");
		process.env.GIT_CONFIG_NOSYSTEM = "1";
		source = fresh("source");
	});
	after(() => {
		for (const key of Object.keys(process.env))
			if (!(key in saved)) delete process.env[key];
		Object.assign(process.env, saved);
		rmSync(root, { recursive: true, force: true });
	});

	it("reads a plain linked worktree", async () => {
		const wt = join(root, "plain");
		run(source, "worktree", "add", "-q", "-b", "plain", wt);
		assert.deepEqual(await identifyWorktree(wt), {
			branch: "plain",
			sourceRepo: source,
		});
	});

	it("trims trailing whitespace from HEAD like Git", async () => {
		const repo = fresh("spaced");
		writeFileSync(join(repo, ".git", "HEAD"), "ref: refs/heads/main \r\n");
		assert.equal(run(repo, "symbolic-ref", "HEAD").trim(), "refs/heads/main");
		assert.equal((await identifyWorktree(repo)).branch, "main");
	});

	it("leaves a symbolic-ref branch unknown", async () => {
		const repo = fresh("symbolic");
		run(repo, "symbolic-ref", "refs/heads/alias", "refs/heads/main");
		writeFileSync(join(repo, ".git", "HEAD"), "ref: refs/heads/alias\n");
		assert.equal((await identifyWorktree(repo)).branch, undefined);
	});

	for (const [name, config] of [
		["core.worktree on the header line", "[core] worktree = /elsewhere\n"],
		["include", "[include]\n\tpath = extra\n"],
		["includeIf", '[includeIf "gitdir:/x/"]\n\tpath = extra\n'],
	])
		it(`leaves the source unknown with ${name}`, async () => {
			const repo = fresh(name.replace(/\W+/g, "-"));
			execFileSync("sh", [
				"-c",
				`printf '%s' "$1" >> "$2"`,
				"sh",
				config,
				join(repo, ".git", "config"),
			]);
			assert.equal((await identifyWorktree(repo)).sourceRepo, undefined);
		});

	it("leaves a submodule's source unknown", async () => {
		const sub = fresh("sub-origin");
		const superRepo = fresh("super");
		run(superRepo, "submodule", "add", "-q", sub, "child");
		const hint = await identifyWorktree(join(superRepo, "child"));
		assert.equal(hint.sourceRepo, undefined);
	});

	it("resolves commondir from the real gitdir behind a symlink", async () => {
		const wt = join(root, "linked");
		run(source, "worktree", "add", "-q", "-b", "linked", wt);
		mkdirSync(join(root, "deep", "er"), { recursive: true });
		const alias = join(root, "deep", "er", "gitdir");
		symlinkSync(join(source, ".git", "worktrees", "linked"), alias);
		writeFileSync(join(wt, ".git"), `gitdir: ${alias}\n`);
		assert.equal(run(wt, "rev-parse", "--abbrev-ref", "HEAD").trim(), "linked");
		assert.deepEqual(await identifyWorktree(wt), {
			branch: "linked",
			sourceRepo: source,
		});
	});

	it("returns no identity for a malformed .git file", async () => {
		const dir = join(root, "malformed");
		mkdirSync(dir);
		writeFileSync(join(dir, ".git"), "not a pointer\n");
		assert.deepEqual(await identifyWorktree(dir), {});
	});
});
