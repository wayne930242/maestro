import "../clean-host-env.ts";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, test } from "node:test";
import { PiHarnessAdapter } from "../../maestro/adapters/pi/pi-harness-adapter.ts";
import { gitEnvironment } from "../../maestro/core/git-environment.ts";
import * as runtime from "../../maestro/runtime/index.ts";
import { createWorktreeOperations } from "../../maestro/runtime/worktree-operations.ts";
import {
	skipWorktreesOnWindows,
	worktreesUnsupportedOnWindows,
} from "../helpers/windows-scope.ts";
import { paneConfig, usingFixture } from "./pi-harness-adapter-fixture.ts";
import { fixture } from "./pi-run-session-fixture.ts";

function initializeWorktreeFixture(dir: string) {
	const git = (args: string[]) =>
		execFileSync("git", args, { cwd: dir, stdio: "pipe" });
	git(["init", "-q", "-b", "main"]);
	git([
		"-c",
		"user.name=Test",
		"-c",
		"user.email=test@example.invalid",
		"-c",
		"commit.gpgsign=false",
		"commit",
		"--allow-empty",
		"-qm",
		"base",
	]);
	return git;
}

describe("PiHarnessAdapter project packages", () => {
	it(
		"seeds a subdirectory project's packages where the launched child reads them",
		{
			skip: worktreesUnsupportedOnWindows,
		},
		async () =>
			usingFixture(async (f) => {
				const repo = join(f.root, "repo");
				const app = join(repo, "apps", "web");
				mkdirSync(app, { recursive: true });
				writeFileSync(join(app, "README.md"), "app\n");
				const git = (...args: string[]) =>
					execFileSync("git", args, {
						cwd: repo,
						env: gitEnvironment(),
						stdio: "ignore",
					});
				git("init", "-q", "-b", "main");
				git("add", ".");
				git(
					"-c",
					"user.name=t",
					"-c",
					"user.email=t@example.test",
					"commit",
					"-q",
					"-m",
					"init",
				);
				mkdirSync(join(app, ".pi", "npm", "node_modules", "pi-code"), {
					recursive: true,
				});
				writeFileSync(
					join(app, ".pi", "npm", "node_modules", "pi-code", "index.js"),
					"1\n",
				);
				// The fake provider names the worktree path but creates no checkout.
				const createWorktreeSurface = f.surface.createWorktreeSurface.bind(
					f.surface,
				);
				f.surface.createWorktreeSurface = (opts) => {
					const created = createWorktreeSurface(opts);
					mkdirSync(join(created.path, "apps", "web"), { recursive: true });
					return created;
				};
				const adapterWith = (
					effects: ReturnType<typeof createWorktreeOperations>,
				) =>
					new PiHarnessAdapter({
						surface: f.surface,
						paneConfig,
						worktreeOperations: effects,
						modelRegistry: f.modelRegistry,
						supervision: f.supervision,
						parent: {
							cwd: f.root,
							sessionFile: join(f.root, "parent", "parent.jsonl"),
							sessionId: "parent",
							sessionDir: join(f.root, "parent"),
							agentDir: join(f.root, "agent"),
						},
						parentRuntime: {
							provider: "fake",
							modelId: "test",
							thinking: "off",
						},
					});
				const adapter = adapterWith(createWorktreeOperations());
				const seeded = await adapter.spawn({
					...f.options,
					cwd: app,
					worktreeRequest: { branch: "seeded" },
				});
				const childCwd = seeded.worktree!.path;
				assert.equal(adapter.getRunningChild(seeded).cwd, childCwd);
				assert.ok(
					existsSync(
						join(childCwd, ".pi", "npm", "node_modules", "pi-code", "index.js"),
					),
				);
			}),
	);
});

test("a seeding warning or failure rides the launch record and never fails the launch", (t) =>
	fixture(async (f) => {
		if (skipWorktreesOnWindows(t)) return;
		initializeWorktreeFixture(f.dir);
		const worktreeOps = createWorktreeOperations();
		let mode: "warn" | "throw" = "warn";
		worktreeOps.seedProjectPackages = async (sourceCwd, worktreePath) => {
			assert.equal(sourceCwd, f.dir);
			assert.equal(worktreePath, f.dir);
			if (mode === "throw") throw new Error("disk exploded");
			return ["Project package seeding failed for .pi/npm: no space"];
		};
		f.options.infrastructure!.worktreeOperations = worktreeOps;
		const session = runtime.createDefaultRunSession(f.options);
		try {
			for (const [branch, expected] of [
				["warned", /no space/],
				["thrown", /Project package seeding failed: disk exploded/],
			] as const) {
				mode = branch === "warned" ? "warn" : "throw";
				const pane = f.provider.createSurface({ name: branch, cwd: f.dir });
				f.operations.createWorktree = (_name, _cwd, name) => ({
					path: f.dir,
					branch: name,
					workspaceId: `workspace-${name}`,
					paneId: pane,
				});
				const input = f.input(`seed-${branch}`);
				input.task.worktree = { branch };
				await session.spawnPi(input);
				const record = session.getRecord(input.task.id)!;
				assert.match(record.worktree?.diagnostics?.join("\n") ?? "", expected);
			}
		} finally {
			await session.shutdown("quit");
		}
	}));
