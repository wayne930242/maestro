import { execFileSync, spawn } from "node:child_process";
import {
	chmodSync,
	existsSync,
	mkdirSync,
	renameSync,
	lstatSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync,
	unlinkSync,
} from "node:fs";
import { lstat, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { isRecord, type JsonObject } from "../core/config/type-guards.ts";
import { gitEnvironment } from "../core/git-environment.ts";
import { Deadline } from "../core/deadline.ts";
import { realpathWithoutOpening } from "../core/realpath-without-opening.ts";
import type { SurfaceProvider } from "../core/surface-provider.ts";
import type {
	CleanupGitState,
	HolderInspection,
	WorktreeCleanupOperations,
	WorktreeIdentityHint,
} from "../core/worktree-cleanup.ts";
import {
	isWorktreeManifest,
	mergeWorktreeManifest,
	type WorktreeLaunch,
	type WorktreeHandoff,
	type WorktreeResultState,
	type WorktreeOperations,
} from "../core/worktree.ts";

function message(error: any): string {
	return error instanceof Error ? error.message : String(error);
}
function contained(root: string, path: string): boolean {
	const rel = relative(root, path);
	return (
		rel === "" ||
		(rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))
	);
}

export const GIT_BASE_TIMEOUT_MS = 10_000;
export const GIT_SOURCE_TIMEOUT_MS = 15_000;
export const GIT_HANDOFF_TIMEOUT_MS = 15_000;
const GIT_OUTPUT_BYTES = 1024 * 1024;

/** One owned read client; expiry bounds the wait even if descendants hold pipes. */
async function gitRead(
	cwd: string,
	args: string[],
	deadline: Deadline,
): Promise<string> {
	const timeout = deadline.remainingMs();
	return new Promise((resolve, reject) => {
		const child = spawn("git", args, {
			cwd,
			env: gitEnvironment(),
			stdio: ["ignore", "pipe", "pipe"],
			detached: process.platform !== "win32",
		});
		let settled = false,
			bytes = 0,
			errorBytes = 0;
		const output: Buffer[] = [],
			errors: Buffer[] = [];
		const fail = (error: Error) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			try {
				if (process.platform !== "win32" && child.pid)
					process.kill(-child.pid, "SIGKILL");
				else child.kill("SIGKILL");
			} catch {
				/* already exited */
			}
			child.stdout.destroy();
			child.stderr.destroy();
			child.unref();
			reject(error);
		};
		const timer = setTimeout(
			() => fail(new Error("Git inspection deadline exceeded")),
			timeout,
		);
		child.on("error", fail);
		child.stdout.on("data", (chunk: Buffer) => {
			bytes += chunk.length;
			if (bytes > GIT_OUTPUT_BYTES)
				fail(new Error("Git output limit exceeded"));
			else output.push(chunk);
		});
		child.stderr.on("data", (chunk: Buffer) => {
			errorBytes += chunk.length;
			if (errorBytes > GIT_OUTPUT_BYTES)
				fail(new Error("Git error output limit exceeded"));
			else errors.push(chunk);
		});
		child.on("close", (code, signal) => {
			if (settled) return;
			if (deadline.expired())
				return fail(new Error("Git inspection deadline exceeded"));
			if (code !== 0)
				return fail(
					new Error(
						`Git exited ${code ?? signal}: ${Buffer.concat(errors).toString("utf8")}`,
					),
				);
			settled = true;
			clearTimeout(timer);
			resolve(Buffer.concat(output).toString("utf8"));
		});
	});
}

function gitSha(output: string): string {
	const sha = output.trim();
	if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(sha))
		throw new Error("Git returned an invalid commit SHA");
	return sha;
}

export async function resolveGitCommit(
	cwd: string,
	ref: string,
): Promise<string> {
	return gitSha(
		await gitRead(
			cwd,
			["rev-parse", "--verify", `${ref}^{commit}`],
			Deadline.after(GIT_BASE_TIMEOUT_MS),
		),
	);
}

/** Total wall time for seeding every project package dir of one launch. */
export const PROJECT_PACKAGE_SEED_TIMEOUT_MS = 60_000;

function isRealDirectory(path: string): boolean {
	try {
		return lstatSync(path).isDirectory();
	} catch {
		return false;
	}
}

function hasEntries(path: string): boolean {
	try {
		return readdirSync(path).length > 0;
	} catch {
		return false;
	}
}

/**
 * Project package dirs Pi installs under `.pi/`. `npm` is installed once it holds
 * `node_modules`; `git` has no marker, so any content counts.
 */
const PROJECT_PACKAGE_DIRS: ReadonlyArray<{
	name: string;
	installed(dir: string): boolean;
}> = [
	{
		name: "npm",
		installed: (dir) => isRealDirectory(join(dir, "node_modules")),
	},
	{ name: "git", installed: hasEntries },
];

/** Copy attempts in order: an APFS/reflink clone where the host has one, then a plain copy. */
function copyAttempts(): string[][] {
	if (process.platform === "darwin") return [["-cR"], ["-R"]];
	if (process.platform === "linux") return [["-R", "--reflink=auto"], ["-R"]];
	return [["-R"]];
}

/** One owned `cp`; the deadline kills its process group so a huge tree cannot hold the launch. */
async function runCopy(
	args: string[],
	source: string,
	destination: string,
	deadline: Deadline,
): Promise<void> {
	const timeout = deadline.remainingMs();
	return new Promise((resolvePromise, reject) => {
		const child = spawn("cp", [...args, `${source}${sep}.`, destination], {
			stdio: ["ignore", "ignore", "pipe"],
			detached: process.platform !== "win32",
		});
		let settled = false;
		const errors: Buffer[] = [];
		let errorBytes = 0;
		const fail = (error: Error) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			reject(error);
		};
		const timer = setTimeout(() => {
			try {
				if (process.platform !== "win32" && child.pid)
					process.kill(-child.pid, "SIGKILL");
				else child.kill("SIGKILL");
			} catch {
				/* already exited */
			}
			child.stderr.destroy();
			child.unref();
			fail(new Error(`copy exceeded its ${timeout}ms budget`));
		}, timeout);
		child.on("error", fail);
		child.stderr.on("data", (chunk: Buffer) => {
			errorBytes += chunk.length;
			if (errorBytes <= 4096) errors.push(chunk);
		});
		child.on("close", (code, signal) => {
			if (settled) return;
			if (code !== 0)
				return fail(
					new Error(
						`cp exited ${code ?? signal}: ${Buffer.concat(errors).toString("utf8").trim()}`,
					),
				);
			settled = true;
			clearTimeout(timer);
			resolvePromise();
		});
	});
}

function removePackageStage(path: string): void {
	const options = {
		recursive: true,
		force: true,
		maxRetries: 3,
		retryDelay: 25,
	};
	try {
		rmSync(path, options);
	} catch (error) {
		if (
			!(error instanceof Error) ||
			!("code" in error) ||
			(error.code !== "EACCES" && error.code !== "EPERM")
		)
			throw error;
		// A failed copy can leave a directory with the source's unreadable mode.
		// Restore access only in staging; do not follow copied symbolic links.
		const pending = [path];
		while (pending.length) {
			const dir = pending.pop()!;
			const stat = lstatSync(dir, { throwIfNoEntry: false });
			if (!stat?.isDirectory()) continue;
			chmodSync(dir, 0o700);
			for (const entry of readdirSync(dir, { withFileTypes: true })) {
				if (entry.isDirectory()) pending.push(join(dir, entry.name));
			}
		}
		rmSync(path, options);
	}
}

function packageDestination(
	path: string,
): "empty" | "ignore-only" | "occupied" {
	const stat = lstatSync(path, { throwIfNoEntry: false });
	if (!stat) return "empty";
	if (!stat.isDirectory()) return "occupied";
	const entries = readdirSync(path, { withFileTypes: true });
	if (!entries.length) return "empty";
	return entries.length === 1 &&
		entries[0].name === ".gitignore" &&
		entries[0].isFile()
		? "ignore-only"
		: "occupied";
}

function publishPackageStage(staging: string, target: string): void {
	const kind = packageDestination(target);
	if (kind === "occupied") return;
	if (kind === "empty") {
		renameSync(staging, target);
		return;
	}
	// Pi commonly leaves a tracked .gitignore in an otherwise empty package
	// directory. Preserve it and publish only the entries from our staged copy.
	const moved: string[] = [];
	try {
		for (const name of readdirSync(staging)) {
			if (name === ".gitignore") continue;
			const destination = join(target, name);
			if (lstatSync(destination, { throwIfNoEntry: false }))
				throw new Error(
					`package destination appeared during seeding: ${destination}`,
				);
			renameSync(join(staging, name), destination);
			moved.push(name);
		}
	} catch (error) {
		for (const name of moved.reverse())
			renameSync(join(target, name), join(staging, name));
		throw error;
	}
}

/**
 * Seeds a new managed worktree with the source checkout's installed project
 * packages (`.pi/npm`, `.pi/git`), which are gitignored and so never reach the
 * worktree. Without them the child's Pi installs them at startup, which can
 * outlast launch readiness. Pi reads project packages relative to its own
 * cwd (the worktree root), even when the source project was a subdirectory.
 * Returns warnings; it never throws.
 */
export async function seedProjectPackages(
	sourceCwd: string,
	targetCwd: string,
): Promise<string[]> {
	const warnings: string[] = [];
	const sourcePi = join(sourceCwd, ".pi");
	if (!isRealDirectory(sourcePi)) return warnings;
	let targetPi: string;
	try {
		targetPi = join(realpathSync(targetCwd), ".pi");
	} catch (error) {
		return [`Project package seeding skipped: ${message(error)}`];
	}
	const deadline = Deadline.after(PROJECT_PACKAGE_SEED_TIMEOUT_MS);
	for (const { name, installed } of PROJECT_PACKAGE_DIRS) {
		const source = join(sourcePi, name);
		const target = join(targetPi, name);
		if (!isRealDirectory(source) || !installed(source)) continue;
		let failure = "";
		let copied = false;
		for (const args of copyAttempts()) {
			let staging: string | undefined;
			let staged = false;
			try {
				const pi = lstatSync(targetPi, { throwIfNoEntry: false });
				if (pi && !pi.isDirectory())
					throw new Error("worktree .pi is not a real directory");
				if (!pi) mkdirSync(targetPi);
				// Never merge into an occupied checkout or follow a destination link.
				if (packageDestination(target) === "occupied") {
					copied = true;
					break;
				}
				staging = mkdtempSync(join(targetPi, `.seed-${name}-`));
				await runCopy(args, source, staging, deadline);
				staged = true;
				publishPackageStage(staging, target);
				copied = true;
			} catch (error) {
				failure = message(error);
			} finally {
				if (staging) {
					try {
						removePackageStage(staging);
					} catch (error) {
						warnings.push(
							`Cannot remove project package staging directory: ${message(error)}`,
						);
					}
				}
			}
			if (copied || staged || deadline.expired()) break;
		}
		if (!copied)
			warnings.push(
				`Project package seeding failed for .pi/${name}; the child will install its own: ${failure}`,
			);
	}
	return warnings;
}

export async function resolveWorktreeProvisionCwd(
	sourceCwd: string,
): Promise<string> {
	const deadline = Deadline.after(GIT_SOURCE_TIMEOUT_MS);
	let gitDir: string;
	let commonDir: string;
	try {
		gitDir = await resolveGitPath(sourceCwd, "--git-dir", deadline);
		commonDir = await resolveGitPath(sourceCwd, "--git-common-dir", deadline);
	} catch (error) {
		throw new Error(
			`Unable to identify the Git checkout for worktree provisioning from ${sourceCwd}: ${errorMessage(error)}`,
		);
	}
	if (gitDir === commonDir) return sourceCwd;

	try {
		const output = await gitRead(
			sourceCwd,
			["worktree", "list", "--porcelain", "-z"],
			deadline,
		);
		const principal = output
			.split("\0")
			.find((record) => record.startsWith("worktree "))
			?.slice("worktree ".length);
		if (!principal) throw new Error("Git returned no principal worktree");
		return principal;
	} catch (error) {
		throw new Error(
			`Unable to determine the principal Git checkout for linked worktree ${sourceCwd}: ${errorMessage(error)}`,
		);
	}
}

async function resolveGitPath(
	cwd: string,
	flag: "--git-dir" | "--git-common-dir",
	deadline: Deadline,
): Promise<string> {
	const output = await gitRead(
		cwd,
		["rev-parse", "--path-format=absolute", flag],
		deadline,
	);
	if (!output || output === "\n")
		throw new Error("Git returned no checkout path");
	return output.endsWith("\n") ? output.slice(0, -1) : output;
}

export function readWorktreeManifest(path: string): JsonObject | undefined {
	try {
		const value: unknown = JSON.parse(readFileSync(path, "utf8"));
		if (isRecord(value) && isWorktreeManifest(value)) return value;
	} catch {
		// Unreachable or malformed manifests do not establish ownership.
	}
	return undefined;
}

export function writeWorktreeManifest(path: string, value: JsonObject): void {
	mkdirSync(dirname(path), { recursive: true });
	let existing: JsonObject = {};
	if (existsSync(path)) {
		try {
			existing = JSON.parse(readFileSync(path, "utf8"));
		} catch {
			existing = {};
		}
	}
	const tempPath = `${path}.tmp`;
	writeFileSync(
		tempPath,
		`${JSON.stringify(
			mergeWorktreeManifest(existing, value, Date.now()),
			null,
			2,
		)}\n`,
	);
	renameSync(tempPath, path);
}

async function gitPathList(
	cwd: string,
	args: string[],
	deadline: Deadline,
): Promise<string[]> {
	const output = await gitRead(cwd, args, deadline);
	if (output && !output.endsWith("\0"))
		throw new Error("Git returned an incomplete NUL filename list");
	return output.split("\0").filter(Boolean);
}

export async function captureWorktreeHandoff(
	worktree: WorktreeLaunch,
	timeoutMs = GIT_HANDOFF_TIMEOUT_MS,
): Promise<WorktreeHandoff> {
	const deadline = Deadline.after(timeoutMs);
	try {
		const headSha = gitSha(
			await gitRead(
				worktree.path,
				["rev-parse", "--verify", "HEAD^{commit}"],
				deadline,
			),
		);
		const status = await gitRead(
			worktree.path,
			["status", "--porcelain=v1", "--untracked-files=all", "-z"],
			deadline,
		);
		if (status && !status.endsWith("\0"))
			throw new Error("Git returned incomplete status");
		const untrackedFiles = await gitPathList(
			worktree.path,
			["ls-files", "--others", "--exclude-standard", "-z"],
			deadline,
		);
		const conflictedFiles = await gitPathList(
			worktree.path,
			["diff", "--name-only", "--diff-filter=U", "-z"],
			deadline,
		);
		const changedFiles = new Set([
			...(await gitPathList(
				worktree.path,
				["diff", "--name-only", "-z", `${worktree.baseSha}...HEAD`],
				deadline,
			)),
			...(await gitPathList(
				worktree.path,
				["diff", "--name-only", "-z"],
				deadline,
			)),
			...(await gitPathList(
				worktree.path,
				["diff", "--cached", "--name-only", "-z"],
				deadline,
			)),
			...untrackedFiles,
		]);
		const count = (
			await gitRead(
				worktree.path,
				["rev-list", "--count", `${worktree.baseSha}..HEAD`],
				deadline,
			)
		).trim();
		const commitsAhead = Number(count);
		if (!/^(0|[1-9][0-9]*)$/.test(count) || !Number.isSafeInteger(commitsAhead))
			throw new Error("Git returned an invalid commit count");
		return {
			...worktree,
			headSha,
			commitsAhead,
			clean: status.length === 0,
			conflicted: conflictedFiles.length > 0,
			changedFiles: [...changedFiles].sort(),
			untrackedFiles: untrackedFiles.sort(),
		};
	} catch (error) {
		return {
			...worktree,
			headSha: null,
			commitsAhead: null,
			clean: null,
			conflicted: null,
			changedFiles: null,
			untrackedFiles: null,
			gitError: errorMessage(error),
		};
	}
}

export function persistWorktreeResult(
	worktree: WorktreeLaunch,
	state: WorktreeResultState,
	handoff?: WorktreeHandoff,
): void {
	writeWorktreeManifest(worktree.manifestFile, {
		state,
		...worktree,
		...handoff,
	});
}

function errorMessage(error: any): string {
	return error instanceof Error ? error.message : String(error);
}

const CLEANUP_TIMEOUT_MS = 30_000;
/** execFileSync's default maxBuffer, shared by stdout and stderr. */
const CLEANUP_OUTPUT_BYTES = 1024 * 1024;

/**
 * execFileSync's contract without blocking the event loop: the same timeout,
 * kill signal, output limit and error text (`spawnSync <file> <code>` for a
 * spawn failure, timeout or overflow; `Command failed: <file> <args>` and any
 * stderr for a failed exit).
 */
function execFileText(
	file: string,
	args: string[],
	options: { cwd?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number },
): Promise<string> {
	return new Promise((resolvePromise, reject) => {
		const stdout: Buffer[] = [];
		const stderr: Buffer[] = [];
		let outputBytes = 0;
		let settled = false;
		let stopped: string | undefined;
		const details = (status: number | null, signal: string | null) => ({
			status,
			signal,
			stdout: Buffer.concat(stdout).toString("utf8"),
			stderr: Buffer.concat(stderr).toString("utf8"),
		});
		const syscallError = (code: string | undefined) =>
			Object.assign(new Error(`spawnSync ${file} ${code}`), {
				code,
				syscall: `spawnSync ${file}`,
				path: file,
				spawnargs: args,
			});
		const settle = (finish: () => void) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			finish();
		};
		let child: ReturnType<typeof spawn>;
		try {
			child = spawn(file, args, {
				cwd: options.cwd,
				env: options.env,
				stdio: ["ignore", "pipe", "pipe"],
			});
		} catch (error) {
			// SAFETY: spawn throws Node system errors with an errno code.
			reject(syscallError((error as NodeJS.ErrnoException).code));
			return;
		}
		const stop = (code: string) => {
			if (stopped) return;
			stopped = code;
			child.kill("SIGKILL");
			// A grandchild (a hook's background job) can keep the pipes open
			// after the child exits; 'close' must not wait for it.
			child.stdout?.destroy();
			child.stderr?.destroy();
		};
		const timer = setTimeout(
			() => stop("ETIMEDOUT"),
			options.timeoutMs ?? CLEANUP_TIMEOUT_MS,
		);
		const collect = (into: Buffer[]) => (chunk: Buffer) => {
			if (stopped) return;
			outputBytes += chunk.length;
			if (outputBytes > CLEANUP_OUTPUT_BYTES) stop("ENOBUFS");
			else into.push(chunk);
		};
		child.stdout?.on("data", collect(stdout));
		child.stderr?.on("data", collect(stderr));
		child.on("error", (error: NodeJS.ErrnoException) =>
			settle(() => reject(syscallError(error.code))),
		);
		child.on("close", (status, signal) =>
			settle(() => {
				if (stopped)
					return reject(
						Object.assign(syscallError(stopped), details(status, signal)),
					);
				const result = details(status, signal);
				if (status === 0) return resolvePromise(result.stdout);
				reject(
					Object.assign(
						new Error(
							`Command failed: ${[file, ...args].join(" ")}${result.stderr ? `\n${result.stderr}` : ""}`,
						),
						result,
					),
				);
			}),
		);
	});
}

function git(cwd: string, args: string[]): Promise<string> {
	return execFileText("git", args, { cwd, env: gitEnvironment() });
}
function exists(path: string): boolean {
	try {
		lstatSync(path);
		return true;
	} catch (error) {
		// SAFETY: filesystem calls throw Node errors with an optional errno code.
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
		throw error;
	}
}
function directories(path: string): string[] {
	if (!exists(path)) return [];
	return readdirSync(path, { withFileTypes: true })
		.filter((item) => item.isDirectory() || item.isSymbolicLink())
		.map((item) => join(path, item.name));
}

/** Source identity is resolved independently of status so Git failures remain visible. */
async function resolveSource(path: string): Promise<string> {
	const common = realpathWithoutOpening(
		(
			await git(path, [
				"rev-parse",
				"--path-format=absolute",
				"--git-common-dir",
			])
		).trim(),
	);
	// A submodule's common directory lives under the superproject's
	// .git/modules; only core.worktree, including included config, names its checkout.
	const configured = (
		await git(common, [
			`--git-dir=${common}`,
			"config",
			"--default",
			"",
			"--get",
			"core.worktree",
		])
	).trim();
	const root = realpathWithoutOpening(
		configured ? resolve(common, configured) : dirname(common),
	);
	if (
		realpathWithoutOpening(
			(await git(root, ["rev-parse", "--show-toplevel"])).trim(),
		) !== root
	)
		throw new Error("Cannot prove source repository root");
	if (
		realpathWithoutOpening(
			(
				await git(root, [
					"rev-parse",
					"--path-format=absolute",
					"--git-common-dir",
				])
			).trim(),
		) !== common
	)
		throw new Error("Source Git directory mismatch");
	return root;
}
/** Count NUL-delimited file paths without retaining the ignored-file listing. */
function countIgnoredFiles(cwd: string): Promise<number> {
	return new Promise((resolve, reject) => {
		const child = spawn(
			"git",
			["ls-files", "--others", "--ignored", "--exclude-standard", "-z"],
			{
				cwd,
				env: gitEnvironment(),
				stdio: ["ignore", "pipe", "ignore"],
				timeout: CLEANUP_TIMEOUT_MS,
				killSignal: "SIGKILL",
			},
		);
		let count = 0;
		child.stdout.on("data", (chunk: Buffer) => {
			for (const byte of chunk) if (byte === 0) count++;
		});
		child.on("error", reject);
		child.on("close", (code, signal) => {
			if (code === 0) resolve(count);
			else
				reject(
					new Error(
						`Ignored-file inspection failed (${signal ?? `exit ${code}`})`,
					),
				);
		});
	});
}

async function inspectGit(
	path: string,
	sourceRepo: string,
): Promise<CleanupGitState> {
	const records = (
		await git(sourceRepo, ["worktree", "list", "--porcelain", "-z"])
	)
		.split("\0\0")
		.map((record) => record.split("\0"));
	const record = records.find((fields) => {
		if (!fields[0]?.startsWith("worktree ")) return false;
		const registeredPath = fields[0].slice("worktree ".length);
		return (
			exists(registeredPath) && realpathWithoutOpening(registeredPath) === path
		);
	});
	// rev-parse returns HEAD for a detached checkout, without treating a valid
	// detached state as an inspection error. Only named refs may be preserved.
	const headRef = (
		await git(path, ["rev-parse", "--symbolic-full-name", "HEAD"])
	).trim();
	const branch = headRef.startsWith("refs/heads/")
		? headRef.slice("refs/heads/".length)
		: "";
	const status = await git(path, [
		"status",
		"--porcelain=v1",
		"--untracked-files=all",
		"-z",
	]);
	let dirtyFiles = 0;
	const fields = status.split("\0");
	for (let i = 0; i < fields.length; i++) {
		if (!fields[i]) continue;
		dirtyFiles++;
		if (/^[RC]|^.[RC]/.test(fields[i])) i++;
	}
	return {
		branch,
		headSha: (await git(path, ["rev-parse", "HEAD"])).trim(),
		registered:
			!!record &&
			path !== sourceRepo &&
			(branch
				? record.includes(`branch refs/heads/${branch}`)
				: record.includes("detached")),
		locked: !!record?.some(
			(field) => field === "locked" || field.startsWith("locked "),
		),
		dirtyFiles,
		untrackedFiles: (
			await git(path, ["ls-files", "--others", "--exclude-standard", "-z"])
		)
			.split("\0")
			.filter(Boolean).length,
		ignoredFiles: await countIgnoredFiles(path),
		conflicts: (
			await git(path, ["diff", "--name-only", "--diff-filter=U", "-z"])
		)
			.split("\0")
			.filter(Boolean).length,
		submodules: (await git(path, ["submodule", "status", "--recursive"]))
			.split("\n")
			.some((line) => line.length > 0 && !line.startsWith("-")),
	};
}

function lsofCwdArgs(uid: number): string[] {
	return ["-n", "-P", "-a", "-u", String(uid), "-d", "cwd", "-Fpcn"];
}

/** The Darwin same-user cwd listing, read synchronously. */
function readLsofCwds(uid: number): string {
	return execFileSync("lsof", lsofCwdArgs(uid), {
		encoding: "utf8",
		timeout: CLEANUP_TIMEOUT_MS,
		killSignal: "SIGKILL",
		stdio: ["ignore", "pipe", "pipe"],
	});
}

/**
 * Individual visibility gaps warn; failed enumeration still blocks cleanup.
 * `readCwds` supplies the Darwin lsof listing; cleanup passes one it read
 * asynchronously.
 */
function processHolders(
	path: string,
	idleShellPids = new Set<number>(),
	procRoot = "/proc",
	platform: NodeJS.Platform = process.platform,
	readCwds: (uid: number) => string = readLsofCwds,
): HolderInspection {
	const blockers: string[] = [];
	const unreadable = new Set<string>();
	const shellNames = new Set(["bash", "zsh", "fish", "sh", "dash"]);
	const checkout =
		platform === "linux" || platform === "darwin"
			? realpathWithoutOpening(path)
			: path;
	if (!process.getuid) throw new Error("Process user identity unavailable");
	const uid = process.getuid();
	if (platform === "linux") {
		// Keep enumeration outside the per-process guard: total failure is a blocker.
		const pids = readdirSync(procRoot).filter((name) => /^\d+$/.test(name));
		if (!pids.length) throw new Error("Process enumeration returned no PIDs");
		for (const pid of pids) {
			try {
				if (lstatSync(`${procRoot}/${pid}`).uid !== uid) continue;
				let command = "";
				try {
					command = readFileSync(`${procRoot}/${pid}/comm`, "utf8").trim();
				} catch {
					// An unreadable name cannot exempt a runtime or hide a readable cwd.
					unreadable.add(pid);
				}
				// A shell can exec a runtime without changing PID/process group.
				if (idleShellPids.has(Number(pid)) && shellNames.has(command)) continue;
				let cwd: string;
				try {
					cwd = realpathWithoutOpening(`${procRoot}/${pid}/cwd`);
				} catch (cwdError) {
					// SAFETY: filesystem probes throw Node errors with an optional errno code.
					const code = (cwdError as NodeJS.ErrnoException).code ?? "";
					if (["ENOENT", "ESRCH"].includes(code)) throw cwdError;
					// Same-uid agents can deny stat and readlink here while staying live.
					unreadable.add(pid);
					continue;
				}
				if (contained(checkout, cwd))
					blockers.push(`Live process ${pid} holds the checkout`);
			} catch (error) {
				// SAFETY: filesystem probes throw Node errors with an optional errno code.
				if (
					["ENOENT", "ESRCH"].includes(
						(error as NodeJS.ErrnoException).code ?? "",
					)
				) {
					try {
						// Confirm disappearance without opening: a dangling /proc
						// entry must not look like a live holder.
						realpathWithoutOpening(`${procRoot}/${pid}`);
						if (
							/^State:\s+[ZX]/m.test(
								readFileSync(`${procRoot}/${pid}/status`, "utf8"),
							)
						) {
							unreadable.delete(pid);
							continue;
						}
					} catch {
						// Missing status alone is not proof of process disappearance.
						try {
							realpathWithoutOpening(`${procRoot}/${pid}`);
						} catch (presenceError) {
							// SAFETY: these are Node filesystem errors.
							if (
								["ENOENT", "ESRCH"].includes(
									(presenceError as NodeJS.ErrnoException).code ?? "",
								)
							) {
								unreadable.delete(pid);
								continue;
							}
						}
					}
				}
				unreadable.add(pid);
			}
		}
	} else if (platform === "darwin") {
		// A nonzero lsof exit is a global failure, even if partial stdout exists.
		let output: string;
		try {
			output = readCwds(uid);
		} catch {
			// Command errors may embed partial process output; never disclose it.
			throw new Error("lsof failed to enumerate processes");
		}
		const records = output.split(/^p/m).slice(1);
		if (!records.length)
			throw new Error("Process enumeration returned no PIDs");
		for (const record of records) {
			const [pid, ...fields] = record.split("\n");
			if (!/^\d+$/.test(pid))
				throw new Error("Invalid process enumeration record");
			const command = fields.find((line) => line.startsWith("c"))?.slice(1);
			if (idleShellPids.has(Number(pid)) && command && shellNames.has(command))
				continue;
			const cwd = fields.find((line) => line.startsWith("n"))?.slice(1);
			if (!command) unreadable.add(pid);
			try {
				if (!cwd || !isAbsolute(cwd))
					throw new Error("Process cwd unavailable");
				// Every same-user cwd is resolved, so this must never open a path.
				if (contained(checkout, realpathWithoutOpening(cwd)))
					blockers.push(`Live process ${pid} holds the checkout`);
			} catch {
				unreadable.add(pid);
			}
		}
	} else {
		throw new Error(`Process inspection unsupported on ${platform}`);
	}
	const warnings = [
		"Incomplete process coverage: same-user inspection is permission-limited; other-user processes are not inspected. A protected process could hold the checkout undetected.",
	];
	if (unreadable.size)
		warnings.push(
			`${unreadable.size} process(es) (PIDs ${[...unreadable].slice(0, 10).join(", ")}${unreadable.size > 10 ? ", …" : ""}) have unreadable details; not proven unrelated to the checkout.`,
		);
	return { blockers, warnings };
}

/**
 * On Darwin, read the lsof cwd listing without blocking the event loop, for
 * processHolders to parse. Elsewhere processHolders needs no subprocess.
 */
async function prefetchLsofCwds(): Promise<
	((uid: number) => string) | undefined
> {
	if (process.platform !== "darwin" || !process.getuid) return undefined;
	try {
		const output = await execFileText(
			"lsof",
			lsofCwdArgs(process.getuid()),
			{},
		);
		return () => output;
	} catch (error) {
		return () => {
			throw error;
		};
	}
}

async function readOptional(path: string): Promise<string | undefined> {
	try {
		return await readFile(path, "utf8");
	} catch (error) {
		// SAFETY: filesystem calls throw Node errors with an optional errno code.
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
		throw error;
	}
}

/**
 * A checkout's branch and source repository from its Git files alone, with no
 * subprocess. Whatever Git could resolve differently (a reftable or symbolic
 * branch ref, a configured core.worktree, an include) stays unknown, so
 * removal inspects that checkout in full.
 */
async function identifyWorktree(path: string): Promise<WorktreeIdentityHint> {
	const dotGit = join(path, ".git");
	const stat = await lstat(dotGit);
	let gitDir: string;
	if (stat.isDirectory()) gitDir = dotGit;
	else if (stat.isFile()) {
		const pointer = /^gitdir: ([^\n]+?)\r?\n?$/.exec(
			await readFile(dotGit, "utf8"),
		);
		if (!pointer) return {};
		gitDir = realpathWithoutOpening(resolve(path, pointer[1]));
	} else return {};
	const commonDir = (await readOptional(join(gitDir, "commondir")))?.trim();
	const common = realpathWithoutOpening(resolve(gitDir, commonDir || "."));
	const hint: WorktreeIdentityHint = {};
	// Git ignores trailing whitespace in HEAD.
	const head = (await readFile(join(gitDir, "HEAD"), "utf8")).trimEnd();
	const ref = /^ref: refs\/heads\/(\S+)$/.exec(head)?.[1];
	if (ref !== undefined) {
		const reftable = await lstat(join(common, "reftable")).then(
			() => true,
			() => false,
		);
		const loose = await readOptional(join(common, "refs", "heads", ref));
		if (!reftable && !loose?.startsWith("ref:")) hint.branch = ref;
	} else if (/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(head)) hint.branch = "";
	const config = await readOptional(join(common, "config"));
	// Any mention of worktree or include (core.worktree on the section-header
	// line, includeIf, extensions.worktreeConfig) leaves the source unknown.
	if (config !== undefined && !/worktree|include/i.test(config))
		hint.sourceRepo = realpathWithoutOpening(dirname(common));
	return hint;
}

export const __worktreeCleanupTest__ = {
	execFileText,
	identifyWorktree,
	processHolders,
	realpathWithoutOpening,
};

export function createWorktreeCleanupOperations(
	provider: SurfaceProvider,
	input: {
		manifestDir: string;
		liveHolders: () => { path: string; persistent?: boolean }[];
		managedRoot?: string;
	},
): WorktreeCleanupOperations {
	const root = input.managedRoot ?? join(homedir(), ".herdr", "worktrees");
	let canonicalRoot: string;
	return {
		managedRoot: () => canonicalRoot ?? realpathWithoutOpening(root),
		scan: () => {
			if (!exists(root)) return [];
			canonicalRoot = realpathWithoutOpening(root);
			const checkouts: string[] = [];
			for (const repo of directories(canonicalRoot)) {
				let resolvedRepo: string;
				try {
					resolvedRepo = realpathWithoutOpening(repo);
				} catch {
					// Unresolvable residue stays out of the inventory rather than
					// blocking the whole scan; callers never see it as eligible.
					continue;
				}
				// Never readdir a managed entry until containment is proven without
				// opening: a symlink to a protected directory would freeze Pi.
				if (!contained(canonicalRoot, resolvedRepo)) continue;
				checkouts.push(...directories(resolvedRepo));
			}
			return checkouts;
		},
		realpath: realpathWithoutOpening,
		resolveSource,
		identify: identifyWorktree,
		inspectGit,
		listWorktrees: (source) =>
			provider.listWorktreeSurfaces({
				cwd: source,
				timeoutMs: CLEANUP_TIMEOUT_MS,
			}),
		readManifests: () => {
			if (!exists(input.manifestDir)) return [];
			return readdirSync(input.manifestDir)
				.filter((name) => name.endsWith(".json"))
				.flatMap((name) => {
					const file = join(input.manifestDir, name);
					const value = readWorktreeManifest(file);
					return value ? [{ file, value }] : [];
				});
		},
		holders: async (entry) => {
			const blockers: string[] = input
				.liveHolders()
				.filter((holder) => realpathWithoutOpening(holder.path) === entry.path)
				.map((holder) =>
					holder.persistent
						? "Persistent-specialist lease holds the worktree"
						: "Live child holds the worktree",
				);
			const idleShellPids = new Set<number>();
			if (entry.workspaceId) {
				const panes = await provider.listSurfaces({
					timeoutMs: CLEANUP_TIMEOUT_MS,
				});
				if (!panes) throw new Error("Herdr pane snapshot unavailable");
				const owned = panes.filter(
					(pane) => pane.workspaceId === entry.workspaceId,
				);
				if (!owned.length)
					throw new Error("Open workspace has no observable panes");
				for (const pane of owned) {
					const info = await provider.getProcessInfo(pane.id, {
						timeoutMs: CLEANUP_TIMEOUT_MS,
					});
					if (!info.shellPid || !info.foregroundProcessGroupId)
						throw new Error(`Process state unknown for pane ${pane.id}`);
					// Exempt only Herdr's observed idle retained shell, never a runtime
					// name or a shell running a foreground command.
					if (info.foregroundProcessGroupId === info.shellPid)
						idleShellPids.add(info.shellPid);
					else
						blockers.push(
							`Live child or foreground process in pane ${pane.id}`,
						);
				}
			}
			try {
				const readCwds = await prefetchLsofCwds();
				const inspection = processHolders(
					entry.path,
					idleShellPids,
					undefined,
					undefined,
					readCwds,
				);
				return {
					blockers: [...blockers, ...inspection.blockers],
					warnings: inspection.warnings,
				};
			} catch (error) {
				// Preserve known children and leases even when global inspection fails.
				return {
					blockers: [
						...blockers,
						`Process inspection unavailable: ${message(error)}`,
					],
					warnings: [],
				};
			}
		},
		exists,
		preserve: async (entry) => {
			if (
				!entry.branch ||
				(await git(entry.path, ["symbolic-ref", "--short", "HEAD"])).trim() !==
					entry.branch
			)
				throw new Error("Retained branch changed before preservation");
			const index = (
				await git(entry.path, [
					"rev-parse",
					"--path-format=absolute",
					"--git-path",
					"index",
				])
			).trim();
			const originalIndex = exists(index) ? readFileSync(index) : undefined;
			try {
				await git(entry.path, ["add", "-A"]);
				await git(entry.path, [
					"commit",
					"-m",
					"WIP: preserve worktree before explicit cleanup",
				]);
			} catch (error) {
				if (originalIndex) writeFileSync(index, originalIndex);
				else if (exists(index)) unlinkSync(index);
				throw error;
			}
			return (await git(entry.path, ["rev-parse", "HEAD"])).trim();
		},
		removeWorkspace: (id) =>
			provider.removeWorktreeSurface(id, { timeoutMs: CLEANUP_TIMEOUT_MS }),
		reportOpenedPrimaryWorkspace: (sourceRepo, claims) =>
			provider.reportOpenedPrimaryWorkspace({ sourceRepo, claims }),
		removeCheckout: async (source, path) => {
			await git(source, ["worktree", "remove", "--", path]);
		},
		prune: async (source) => {
			await git(source, ["worktree", "prune"]);
		},
		writeManifest: (file, value) => {
			if (!readWorktreeManifest(file))
				throw new Error(
					"Manifest ownership became unavailable; checkout removed but manifest unchanged",
				);
			writeWorktreeManifest(file, value);
		},
	};
}

export function createWorktreeOperations(): WorktreeOperations {
	return {
		resolveGitCommit,
		resolveWorktreeProvisionCwd,
		seedProjectPackages,
		writeWorktreeManifest,
		captureWorktreeHandoff,
		persistWorktreeResult,
	};
}
