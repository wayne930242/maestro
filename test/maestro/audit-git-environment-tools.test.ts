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
import { join } from "node:path";
import { test } from "node:test";
import { gitEnvironment } from "../../maestro/core/git-environment.ts";
import {
	captureWorktreeHandoff,
	createWorktreeCleanupOperations,
	resolveGitCommit,
	resolveWorktreeProvisionCwd,
} from "../../maestro/runtime/worktree-operations.ts";
import { FakeSurfaceProvider } from "../../maestro/surfaces/fake/fake-surface-provider.ts";
import { worktreesUnsupportedOnWindows } from "../helpers/windows-scope.ts";

test("host Git ignores poisoned repository while preserving linked checkout, includes and hooks", {
	skip: worktreesUnsupportedOnWindows,
}, async () => {
	const root = realpathSync(mkdtempSync(join(tmpdir(), "audit-git-env-")));
	const saved = { ...process.env };
	const run = (cwd: string, ...args: string[]) =>
		execFileSync("git", args, {
			cwd,
			env: gitEnvironment(),
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
		}).trim();
	try {
		process.env.GIT_CONFIG_GLOBAL = join(root, "global");
		process.env.GIT_CONFIG_SYSTEM = "/dev/null";
		process.env.GIT_CONFIG_NOSYSTEM = "1";
		const hooks = join(root, "hooks");
		mkdirSync(hooks);
		writeFileSync(
			join(root, "global"),
			`[include]\n path = ${join(root, "included")}\n`,
		);
		writeFileSync(
			join(root, "included"),
			`[user]\n name = Included User\n email = included@example.test\n[core]\n hooksPath = ${hooks}\n[commit]\n gpgSign = false\n`,
		);
		const source = join(root, "source");
		const other = join(root, "other");
		for (const repo of [source, other]) {
			mkdirSync(repo);
			run(repo, "init", "-q");
			writeFileSync(join(repo, "tracked"), repo);
			writeFileSync(join(repo, ".gitignore"), "ignored\n");
			run(repo, "add", ".");
			run(repo, "commit", "-qm", repo);
		}
		const expected = run(source, "rev-parse", "HEAD");
		const wrong = run(other, "rev-parse", "HEAD");
		assert.notEqual(expected, wrong);
		const linked = join(root, "linked");
		run(source, "worktree", "add", "-qb", "linked", linked);
		writeFileSync(join(linked, "ignored"), "ignored data");
		writeFileSync(join(linked, "new-file"), "preserve me");
		process.env.GIT_DIR = join(other, ".git");
		assert.equal(
			execFileSync("git", ["rev-parse", "HEAD"], {
				cwd: source,
				encoding: "utf8",
			}).trim(),
			wrong,
		);
		const poisoned = { ...process.env };
		assert.equal(await resolveGitCommit(source, "HEAD"), expected);
		assert.equal(await resolveGitCommit(linked, "HEAD"), expected);
		assert.equal(await resolveWorktreeProvisionCwd(linked), source);
		const handoff = await captureWorktreeHandoff({
			path: linked,
			branch: "linked",
			baseSha: expected,
			baseRef: "HEAD",
			workspaceId: "w1",
			paneId: "p1",
			manifestFile: join(root, "manifest"),
		});
		assert.equal(handoff.headSha, expected);
		assert.deepEqual(handoff.changedFiles, ["new-file"]);
		assert.deepEqual(handoff.untrackedFiles, ["new-file"]);
		const ops = createWorktreeCleanupOperations(new FakeSurfaceProvider(), {
			manifestDir: root,
			liveHolders: () => [],
		});
		assert.equal(await ops.resolveSource(linked), source);
		const state = await ops.inspectGit(linked, source);
		assert.equal(state.registered, true);
		assert.equal(state.ignoredFiles, 1);
		assert.equal(state.untrackedFiles, 1);
		const hook = join(hooks, "pre-commit");
		writeFileSync(hook, "#!/bin/sh\nprintf hook > hook-ran\n");
		chmodSync(hook, 0o755);
		const sha = await ops.preserve({
			path: linked,
			branch: "linked",
			contained: true,
			manifest: [],
			classification: "eligible",
			blockers: [],
			warnings: [],
		});
		assert.notEqual(sha, expected);
		assert.equal(readFileSync(join(linked, "hook-ran"), "utf8"), "hook");
		assert.equal(run(other, "rev-parse", "HEAD"), wrong);
		assert.deepEqual({ ...process.env }, poisoned);
	} finally {
		for (const key of Object.keys(process.env))
			if (!(key in saved)) delete process.env[key];
		Object.assign(process.env, saved);
		rmSync(root, { recursive: true, force: true });
	}
});
