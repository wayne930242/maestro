import "../clean-host-env.ts";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
	chmodSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	realpathSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { gitEnvironment } from "../../maestro/core/git-environment.ts";
import { seedProjectPackages } from "../../maestro/runtime/worktree-operations.ts";
import { worktreesUnsupportedOnWindows } from "../helpers/windows-scope.ts";

function git(cwd: string, ...args: string[]) {
	execFileSync("git", args, {
		cwd,
		env: gitEnvironment(),
		stdio: "ignore",
	});
}

/** A repo with a tracked `apps/web` app, plus a worktree checked out from it. */
function fixture() {
	const root = realpathSync(mkdtempSync(join(tmpdir(), "seed-packages-")));
	const repo = join(root, "repo");
	mkdirSync(join(repo, "apps", "web"), { recursive: true });
	writeFileSync(join(repo, "apps", "web", "README.md"), "app\n");
	writeFileSync(join(repo, "README.md"), "root\n");
	writeFileSync(join(repo, ".gitignore"), ".pi/npm/\n.pi/git/\n");
	git(repo, "init", "-q", "-b", "main");
	git(repo, "add", ".");
	git(
		repo,
		"-c",
		"user.name=t",
		"-c",
		"user.email=t@example.test",
		"commit",
		"-q",
		"-m",
		"init",
	);
	const worktree = join(root, "wt");
	git(repo, "worktree", "add", "-q", "-b", "task", worktree);
	return {
		repo,
		worktree,
		dispose: () => rmSync(root, { recursive: true, force: true }),
	};
}

function install(dir: string, name: "npm" | "git") {
	if (name === "npm") {
		mkdirSync(join(dir, ".pi", "npm", "node_modules", "pi-code"), {
			recursive: true,
		});
		writeFileSync(join(dir, ".pi", "npm", "package.json"), "{}\n");
		writeFileSync(
			join(dir, ".pi", "npm", "node_modules", "pi-code", "index.js"),
			"module.exports = 1;\n",
		);
	} else {
		mkdirSync(join(dir, ".pi", "git", "github.com", "o", "r"), {
			recursive: true,
		});
		writeFileSync(
			join(dir, ".pi", "git", "github.com", "o", "r", "package.json"),
			"{}\n",
		);
	}
}

const skip = worktreesUnsupportedOnWindows;

describe("seedProjectPackages", { skip }, () => {
	it("seeds the source's .pi/npm into a root launch cwd", async () => {
		const f = fixture();
		try {
			install(f.repo, "npm");
			assert.deepEqual(await seedProjectPackages(f.repo, f.worktree), []);
			assert.equal(
				readFileSync(
					join(f.worktree, ".pi", "npm", "node_modules", "pi-code", "index.js"),
					"utf8",
				),
				"module.exports = 1;\n",
			);
			assert.ok(existsSync(join(f.worktree, ".pi", "npm", "package.json")));
		} finally {
			f.dispose();
		}
	});

	it("seeds a subdirectory source into the child cwd and copies nothing else", async () => {
		const f = fixture();
		try {
			const app = join(f.repo, "apps", "web");
			install(app, "npm");
			install(f.repo, "npm");
			const index = join(".pi", "npm", "node_modules", "pi-code", "index.js");
			writeFileSync(join(f.repo, index), "module.exports = 'repo root';\n");
			writeFileSync(join(app, "scratch.txt"), "untracked\n");
			assert.deepEqual(await seedProjectPackages(app, f.worktree), []);
			assert.equal(
				readFileSync(join(f.worktree, index), "utf8"),
				"module.exports = 1;\n",
			);
			assert.equal(existsSync(join(f.worktree, "apps", "web", ".pi")), false);
			assert.equal(existsSync(join(f.worktree, "scratch.txt")), false);
		} finally {
			f.dispose();
		}
	});

	it("seeds .pi/git too", async () => {
		const f = fixture();
		try {
			install(f.repo, "git");
			assert.deepEqual(await seedProjectPackages(f.repo, f.worktree), []);
			assert.ok(
				existsSync(
					join(
						f.worktree,
						".pi",
						"git",
						"github.com",
						"o",
						"r",
						"package.json",
					),
				),
			);
		} finally {
			f.dispose();
		}
	});

	it("seeds nothing when the source has nothing installed", async () => {
		const f = fixture();
		try {
			mkdirSync(join(f.repo, ".pi", "npm"), { recursive: true });
			writeFileSync(join(f.repo, ".pi", "npm", "package.json"), "{}\n");
			assert.deepEqual(await seedProjectPackages(f.repo, f.worktree), []);
			assert.equal(existsSync(join(f.worktree, ".pi")), false);
		} finally {
			f.dispose();
		}
	});

	it("leaves a worktree that already has the packages untouched", async () => {
		const f = fixture();
		try {
			install(f.repo, "npm");
			install(f.worktree, "npm");
			writeFileSync(
				join(f.worktree, ".pi", "npm", "node_modules", "pi-code", "index.js"),
				"module.exports = 2;\n",
			);
			assert.deepEqual(await seedProjectPackages(f.repo, f.worktree), []);
			assert.equal(
				readFileSync(
					join(f.worktree, ".pi", "npm", "node_modules", "pi-code", "index.js"),
					"utf8",
				),
				"module.exports = 2;\n",
			);
		} finally {
			f.dispose();
		}
	});

	it("seeds beside a tracked .gitignore without replacing it", async () => {
		const f = fixture();
		try {
			install(f.repo, "npm");
			const marker = join(".pi", "npm", ".gitignore");
			writeFileSync(join(f.repo, marker), "# source\n");
			mkdirSync(join(f.worktree, ".pi", "npm"), { recursive: true });
			const tracked = "*\n!.gitignore\n";
			writeFileSync(join(f.worktree, marker), tracked);
			git(f.worktree, "add", "-f", marker);
			assert.deepEqual(await seedProjectPackages(f.repo, f.worktree), []);
			assert.equal(readFileSync(join(f.worktree, marker), "utf8"), tracked);
			assert.ok(
				existsSync(
					join(f.worktree, ".pi", "npm", "node_modules", "pi-code", "index.js"),
				),
			);
		} finally {
			f.dispose();
		}
	});

	it("does not seed through a worktree .pi symlink", async () => {
		const f = fixture();
		const outside = mkdtempSync(join(tmpdir(), "seed-outside-"));
		try {
			install(f.repo, "npm");
			symlinkSync(outside, join(f.worktree, ".pi"));
			const warnings = await seedProjectPackages(f.repo, f.worktree);
			assert.match(warnings[0], /worktree \.pi is not a real directory/);
			assert.equal(existsSync(join(outside, "npm")), false);
		} finally {
			f.dispose();
			rmSync(outside, { recursive: true, force: true });
		}
	});

	it("reports a failed copy as a warning, leaves no partial seed, and does not throw", async (t) => {
		if (process.getuid?.() === 0) return t.skip("root can read anything");
		const f = fixture();
		const unreadable = join(f.repo, ".pi", "npm", "node_modules", "pi-code");
		try {
			install(f.repo, "npm");
			chmodSync(unreadable, 0o000);
			const warnings = await seedProjectPackages(f.repo, f.worktree);
			assert.equal(warnings.length, 1);
			assert.match(warnings[0], /seeding failed for \.pi\/npm/);
			assert.deepEqual(readdirSync(join(f.worktree, ".pi")), []);
		} finally {
			chmodSync(unreadable, 0o755);
			f.dispose();
		}
	});

	it("warns instead of throwing when the child's cwd cannot be opened", async () => {
		const f = fixture();
		try {
			install(f.repo, "npm");
			const warnings = await seedProjectPackages(
				f.repo,
				join(f.worktree, "missing"),
			);
			assert.equal(warnings.length, 1);
			assert.match(warnings[0], /seeding skipped/);
		} finally {
			f.dispose();
		}
	});
});
