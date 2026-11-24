import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
	cpSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	realpathSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { stripTypeScriptTypes } from "node:module";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const root = fileURLToPath(new URL("../", import.meta.url));
// Real path: Node resolves modules (import.meta.url, the child entry) through
// symlinks, so on macOS a /var/... TMPDIR would compare against /private/var/....
const fixture = realpathSync(
	mkdtempSync(join(tmpdir(), "maestro packed consumer ")),
);
// Never inherit operator Pi config, loader hooks, SDK account paths or credentials.
const env = {
	PATH: process.env.PATH,
	HOME: fixture,
	TMPDIR: fixture,
	npm_config_cache: join(fixture, "npm-cache"),
};
function run(binary: string, args: string[], cwd = fixture): string {
	return execFileSync(binary, args, {
		cwd,
		env,
		encoding: "utf8",
		timeout: 120_000,
	});
}
/** Bare host-peer specifiers reachable through an emitted file's relative imports. */
function peerImports(file: string, seen = new Set<string>()): Set<string> {
	const peers = new Set<string>();
	if (seen.has(file)) return peers;
	seen.add(file);
	const text = readFileSync(file, "utf8");
	for (const { fileName } of ts.preProcessFile(text, true, true)
		.importedFiles) {
		if (/^@earendil-works\/pi-|^@sinclair\/typebox/.test(fileName))
			peers.add(fileName);
		else if (fileName.startsWith("."))
			for (const peer of peerImports(resolve(dirname(file), fileName), seen))
				peers.add(peer);
	}
	return peers;
}

/**
 * Bare host-peer specifiers reachable through an emitted declaration's relative
 * imports. Type-only imports are erased from JS but remain in declarations, so
 * a peer-free TypeScript consumer cannot typecheck such an entry either.
 */
function declarationPeers(file: string, seen = new Set<string>()): Set<string> {
	const peers = new Set<string>();
	if (seen.has(file)) return peers;
	seen.add(file);
	const text = readFileSync(file, "utf8");
	for (const { fileName } of ts.preProcessFile(text, true, true)
		.importedFiles) {
		if (/^@earendil-works\/pi-|^@sinclair\/typebox/.test(fileName))
			peers.add(fileName);
		else if (fileName.startsWith("."))
			for (const peer of declarationPeers(
				resolve(dirname(file), fileName.replace(/\.[jt]s$/, ".d.ts")),
				seen,
			))
				peers.add(peer);
	}
	return peers;
}

/**
 * A host that provides the optional peers (its own node_modules holds Pi and
 * TypeBox, as Pi's install does) loads every Pi entry from the installed JS,
 * composes the run session through a HostSurfaceBinding and launches with the
 * emitted protocol-only child entry, whose registrations equal the source entry's.
 */
function piConsumer(
	fixture: string,
	tarball: string,
	piExports: string[],
	typeExports: string[],
): void {
	const host = join(fixture, "pi host");
	const consumer = join(host, "consumer");
	mkdirSync(consumer, { recursive: true });
	symlinkSync(join(root, "node_modules"), join(host, "node_modules"), "dir");
	writeFileSync(
		join(consumer, "package.json"),
		JSON.stringify({ private: true, type: "module" }),
	);
	run(
		"npm",
		[
			"install",
			"--ignore-scripts",
			"--omit=peer",
			"--offline",
			"--no-audit",
			"--no-fund",
			tarball,
		],
		consumer,
	);
	assert(!existsSync(join(consumer, "node_modules/@earendil-works")));
	assert(!existsSync(join(consumer, "node_modules/@sinclair")));
	const installedEntry = join(
		consumer,
		"node_modules/@nubl/maestro/dist/maestro/adapters/pi/child/entry.js",
	);
	writeFileSync(join(consumer, "pi-exports.json"), JSON.stringify(piExports));
	cpSync(
		join(root, "config.json.example"),
		join(consumer, "config.json.example"),
	);
	writeFileSync(
		join(consumer, "capture-child-entry.mjs"),
		stripTypeScriptTypes(
			readFileSync(join(root, "scripts/capture-child-entry.ts"), "utf8"),
		),
	);
	writeFileSync(
		join(consumer, "pi-consumer.js"),
		`
import assert from "node:assert/strict";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import piExports from "./pi-exports.json" with { type: "json" };
assert(!process.execArgv.some(arg => /loader|strip-types|import/.test(arg)));
for (const name of piExports) {
 const specifier = "@nubl/maestro/" + name.slice(2);
 assert(import.meta.resolve(specifier).includes("node_modules/@nubl/maestro/dist/"));
 await import(specifier);
}
const { DEFAULT_CHILD_ENTRY_PATH } = await import("@nubl/maestro/adapters/pi/launch-command");
const entry = DEFAULT_CHILD_ENTRY_PATH;
assert.equal(entry, ${JSON.stringify(installedEntry)});
assert(existsSync(entry) && entry.includes(" "));
// ./pi/child: the launch entry's default child extension plus the named factory.
const child = await import("@nubl/maestro/pi/child");
assert.equal(typeof child.default, "function");
assert.equal(child.default, (await import(pathToFileURL(entry).href)).default);
assert.equal(child.createChildExtension, (await import("@nubl/maestro/adapters/pi/child/protocol")).createChildExtension);
assert.equal(typeof child.createChildExtension(() => undefined), "function");
// ./pi/extension and ./pi/subagents/index delegate to the one factory.
const { createPiExtension } = await import("@nubl/maestro/pi");
const callable = await import("@nubl/maestro/pi/extension");
assert.equal(callable.default, createPiExtension);
assert.equal(callable.createPiExtension, createPiExtension);
const compat = await import("@nubl/maestro/pi/subagents/index");
const helpers = await import("@nubl/maestro/pi/subagents/extension");
assert.equal(compat.default, createPiExtension);
assert.deepEqual(Object.keys(compat).sort(), ["cleanupSubagentsForShutdown", "createPiExtension", "default", "hasWorkingSubagents", "selectCompletionApi", "shouldAdvanceToFallback", "shouldDeliverSubagentCompletion", "shouldPreserveSubagentsOnShutdown"]);
for (const name of Object.keys(compat)) if (name !== "default") assert.equal(compat[name], helpers[name], name);
assert.equal("__test__" in compat, false);
const { createDefaultRunSession } = await import("@nubl/maestro/runtime");
const { FakeSurfaceProvider } = await import("@nubl/maestro/testing");
const dir = join(process.cwd(), "run dir");
mkdirSync(join(dir, "sessions"), { recursive: true });
const parent = join(dir, "parent.jsonl");
writeFileSync(parent, JSON.stringify({ type: "session", version: 3, id: "parent", cwd: dir }) + "\\n");
const paneConfig = { mode: "tab", direction: "right", maxPerTab: 4 };
const snapshot = {
 parent: { cwd: dir, invocationCwd: dir, sessionFile: parent, sessionId: "parent", sessionDir: join(dir, "sessions"), agentDir: dir },
 parentRuntime: { provider: "test", modelId: "one", thinking: "high" },
 paneConfig,
 modelRegistry: { find: (p, id) => ({ provider: p, id, reasoning: true }), available: () => [], hasConfiguredAuth: () => true, supportedThinkingLevels: () => ["off", "high"], clampThinkingLevel: (_m, level) => level },
};
const base = {
 configDir: dir, configExamplePath: join(process.cwd(), "config.json.example"), forcePolling: false, roles: [],
 getLaunchSnapshot: () => snapshot, hooks: { onSettled() {} },
 persistent: { send: () => ({ error: "fixture" }), stop: () => ({ error: "fixture" }), drain() {} },
};
assert.throws(() => createDefaultRunSession(base), /^Error: Pi run session requires a host surface binding$/);
const launches = [];
let owners = 0;
const hostSurface = {
 resolve: () => ({ backend: "legacy" }),
 createProvider: () => { owners++; return new FakeSurfaceProvider(); },
 createLaunchProvider: () => { const provider = new FakeSurfaceProvider(); launches.push(provider); return provider; },
};
const session = createDefaultRunSession({ ...base, hostSurface, platform: "linux" });
const plan = { provider: "test", modelId: "one", model: "test/one", thinking: "high", modelSource: "request", thinkingSource: "parent" };
const handle = await session.spawnPi({
 task: { id: "smoke", name: "child", prompt: "bounded", role: "", cwd: dir, behavior: { autoExit: true, persistent: false } },
 role: { name: "", version: "1", description: "fixture", systemPrompt: "", allowedTools: [] },
 plans: [plan], resolved: {},
 identity: { id: "public-smoke", logicalId: "logical-smoke", generationId: "generation-smoke", taskId: "inbox-smoke" },
});
assert.equal(owners, 1);
assert.equal(launches.length, 1);
const [command] = launches[0].commands(handle.surfaceId);
assert(command.includes(" -e '" + DEFAULT_CHILD_ENTRY_PATH + "' "), command);
assert.equal((await session.cancel("smoke")).status, "confirmed");
await session.shutdown("quit");
`,
	);
	run(process.execPath, ["pi-consumer.js"], consumer);
	for (const variant of [
		{},
		{ PI_SUBAGENT_AUTO_EXIT: "1" },
		{ PI_SUBAGENT_PERSISTENT: "1", PI_SUBAGENT_NOTIFY: "1" },
	]) {
		const capture = (args: string[], cwd: string) => {
			const output = execFileSync(process.execPath, args, {
				cwd,
				env: { ...env, ...variant },
				encoding: "utf8",
				timeout: 120_000,
			});
			try {
				return JSON.parse(output);
			} catch (cause) {
				throw new Error(
					`Child capture printed no registration JSON: ${output}`,
					{
						cause,
					},
				);
			}
		};
		const installed = capture(
			["capture-child-entry.mjs", installedEntry],
			consumer,
		);
		const source = capture(
			[
				"--experimental-strip-types",
				"--no-warnings",
				join(root, "scripts/capture-child-entry.ts"),
				join(root, "maestro/adapters/pi/child/entry.ts"),
			],
			root,
		);
		assert.deepEqual(installed, source);
		const names = installed.tools.map((tool: { name: string }) => tool.name);
		assert(names.includes("caller_ping"));
		assert.equal(
			names.includes("caller_notify"),
			"PI_SUBAGENT_NOTIFY" in variant,
		);
		assert.equal(
			names.includes("subagent_done"),
			!("PI_SUBAGENT_AUTO_EXIT" in variant),
		);
	}
	piFactory(consumer, installedEntry);
	writeFileSync(
		join(consumer, "consumer.ts"),
		typeExports
			.map(
				(name, index) =>
					`import * as pi${index} from ${JSON.stringify("@nubl/maestro/" + name.slice(2))};\nvoid pi${index};`,
			)
			.join("\n") +
			'\nimport type { HostSurfaceBinding } from "@nubl/maestro/runtime/host-surface-binding";\nimport { FakeSurfaceProvider } from "@nubl/maestro/testing";\nconst binding: HostSurfaceBinding = { resolve: () => ({ backend: "legacy" }), createProvider: () => new FakeSurfaceProvider(), createLaunchProvider: () => new FakeSurfaceProvider() };\nvoid binding;\n',
	);
	writeFileSync(
		join(consumer, "tsconfig.json"),
		JSON.stringify({
			compilerOptions: {
				strict: true,
				noEmit: true,
				module: "nodenext",
				target: "es2023",
				types: ["node"],
				skipLibCheck: true,
			},
			files: ["consumer.ts"],
		}),
	);
	run(
		process.execPath,
		[join(root, "node_modules/typescript/bin/tsc"), "-p", "tsconfig.json"],
		consumer,
	);
	console.log(
		`Installed Pi entries with host peers: ${piExports.length} exports load from emitted JS (${typeExports.length} declarations typecheck), HostSurfaceBinding composition is enforced, launches load the emitted child entry by its installed path (with spaces), and its registrations equal the source child in 3 env variants; declarations typecheck against the peers.`,
	);
}

/** JSON as parsed from the archived contract and the fork's delta list. */
type Json = string | number | boolean | null | Json[] | JsonObject;
interface JsonObject {
	[key: string]: Json;
}

function isJsonObject(value: Json | undefined): value is JsonObject {
	return value instanceof Object && !Array.isArray(value);
}

/**
 * weihung fork: one reviewed difference between H1's archived contract and the
 * fork's registrations. `replace` swaps exactly one occurrence of `from` in the
 * string at `path`; `add` sets the key `path` ends with, absent from H1.
 */
interface ForkContractDelta {
	scopes: ("parent" | "child")[];
	tool: string;
	path: string[];
	op: "replace" | "add";
	from?: string;
	to?: string;
	value?: Json;
	reason: string;
}

/**
 * Apply the fork's documented tool-schema deltas to a copy of H1's pinned
 * tools for one scope. Every delta must apply exactly as recorded (a stale or
 * mismatched record fails), and anything it does not name stays H1's pin.
 */
function withForkDeltas(
	tools: JsonObject[],
	scope: "parent" | "child",
	deltas: ForkContractDelta[],
): JsonObject[] {
	const patched = structuredClone(tools);
	for (const delta of deltas.filter((entry) => entry.scopes.includes(scope))) {
		const label = `${scope} ${delta.tool} ${delta.path.join(".")}`;
		let node: Json | undefined = patched.find(
			(tool) => tool.name === delta.tool,
		);
		for (const key of delta.path.slice(0, -1))
			node = Array.isArray(node)
				? node[Number(key)]
				: isJsonObject(node)
					? node[key]
					: undefined;
		const key = delta.path.at(-1);
		assert(
			isJsonObject(node) && key !== undefined,
			`Fork delta path is absent from H1: ${label}`,
		);
		if (delta.op === "add") {
			assert(!(key in node), `Fork delta adds an H1 key: ${label}`);
			assert(delta.value !== undefined, `Fork delta adds no value: ${label}`);
			node[key] = delta.value;
			continue;
		}
		assert.equal(delta.op, "replace", `Unknown fork delta op: ${label}`);
		const { from, to } = delta;
		const text = String(node[key]);
		assert(
			node[key] === text && from && to !== undefined,
			`Fork delta replaces no string: ${label}`,
		);
		assert.equal(
			text.split(from).length,
			2,
			`Fork delta text must occur once in H1: ${label}`,
		);
		node[key] = text.replace(from, () => to);
	}
	return patched;
}

function parseJson(text: string, what: string) {
	try {
		return JSON.parse(text);
	} catch (cause) {
		throw new Error(`Invalid JSON from ${what}`, { cause });
	}
}

/**
 * M4: the installed createPiExtension (`@nubl/maestro/pi`) registers what the
 * source factory does, per load, in parent and child/deny-tool scopes; equals
 * H1's pinned host contract plus the fork's recorded tool-schema deltas
 * (provenance/fork-h1-contract-deltas.json); resolves the shipped config example; and, with the
 * installed child entry, reproduces the frozen public tool-schema fixture.
 */
function piFactory(consumer: string, installedEntry: string): void {
	const installed = join(consumer, "node_modules/@nubl/maestro");
	assert.equal(
		readFileSync(join(installed, "dist/config.json.example"), "utf8"),
		readFileSync(join(root, "config.json.example"), "utf8"),
	);
	writeFileSync(
		join(consumer, "capture-pi-factory.mjs"),
		stripTypeScriptTypes(
			readFileSync(join(root, "scripts/capture-pi-factory.ts"), "utf8"),
		),
	);
	const capture = (args: string[], cwd: string) => {
		const agentDir = mkdtempSync(join(consumer, "agent dir "));
		const output = execFileSync(process.execPath, [...args, agentDir], {
			cwd,
			env,
			encoding: "utf8",
			timeout: 120_000,
		});
		try {
			return JSON.parse(output);
		} catch (cause) {
			throw new Error(`Factory capture printed no JSON: ${output}`, { cause });
		}
	};
	const fromPackage = capture(
		[
			"capture-pi-factory.mjs",
			join(installed, "dist/maestro/pi.js"),
			join(installed, "dist/pi-extension/subagents/config-path.js"),
		],
		consumer,
	);
	const fromSource = capture(
		[
			"--experimental-strip-types",
			"--no-warnings",
			join(root, "scripts/capture-pi-factory.ts"),
			join(root, "maestro/pi.ts"),
			join(root, "pi-extension/subagents/config-path.ts"),
		],
		root,
	);
	// The default asset root is the installed package's dist/, beside its emitted code.
	assert.equal(
		fromPackage.example.path,
		join(installed, "dist/config.json.example"),
	);
	assert.equal(fromSource.example.path, join(root, "config.json.example"));
	assert.equal(fromPackage.example.text, fromSource.example.text);
	delete fromPackage.example;
	delete fromSource.example;
	assert.deepEqual(fromPackage, fromSource);
	// A fresh load reads the changed user config; the earlier loads used the example.
	assert.deepEqual(fromPackage.statusEnabledPerLoad, [true, true, false]);
	const pinned = parseJson(
		readFileSync(
			join(root, "provenance/upstream/test/fixtures/h1-contract.json"),
			"utf8",
		),
		"the archived H1 contract",
	);
	const forkDeltas: ForkContractDelta[] = parseJson(
		readFileSync(join(root, "provenance/fork-h1-contract-deltas.json"), "utf8"),
		"the fork's H1 contract deltas",
	);
	for (const delta of forkDeltas)
		assert(
			delta.scopes.length > 0 &&
				delta.scopes.every((scope) => scope === "parent" || scope === "child"),
			`Fork delta needs parent and/or child scopes: ${delta.tool}`,
		);
	for (const scope of ["parent", "child"] as const) {
		const actual = fromPackage.scopes[scope];
		assert.deepEqual(actual.testSurface, pinned[scope].testSurface);
		assert.deepEqual(actual.commands, pinned[scope].commands);
		assert.deepEqual(actual.events, pinned[scope].events);
		assert.deepEqual(
			actual.tools.map(
				(tool: { renderCall: boolean; renderResult: boolean }) => {
					const { renderCall: _call, renderResult: _result, ...rest } = tool;
					return rest;
				},
			),
			withForkDeltas(pinned[scope].tools, scope, forkDeltas),
		);
		const names = actual.tools.map((tool: { name: string }) => tool.name);
		assert.equal(new Set(names).size, names.length, "one registration each");
		// Message renderers come only from the host's hook, registered once.
		assert.deepEqual(actual.renderers, ["host-renderer"]);
	}
	writeFileSync(
		join(consumer, "installed-factory.mjs"),
		`
import { createPiExtension } from "@nubl/maestro/pi";
const refuse = () => { throw new Error("schema capture: no terminal provider"); };
const provider = () => new Proxy({ name: "schema-capture", isAvailable: () => false, setupHint: () => "none" }, { get: (target, key) => key in target ? target[key] : key === "nativeExecution" || key === "then" ? undefined : refuse });
const noop = () => {};
export default createPiExtension({
 hostSurface: { resolve: () => ({ backend: "legacy" }), createProvider: provider, createLaunchProvider: provider },
 presentation: { createWidgets: () => ({ renderSubagentWidgetLines: () => [], updateWidget: noop, startStatusRefresh: noop, startWidgetRefresh: noop, stopRefresh: noop }), borderLine: () => "", registerMessageRenderers: noop },
});
`,
	);
	writeFileSync(
		join(consumer, "schema-capture.ts"),
		`
import { captureToolSchemas } from ${JSON.stringify(pathToFileURL(join(root, "test/helpers/tool-schema-capture.ts")).href)};
const fresh = async (url: string) => (await import(url + "?" + Date.now() + Math.random())).default;
const snapshot = await captureToolSchemas({
 parent: () => fresh(new URL("./installed-factory.mjs", import.meta.url).href),
 child: () => fresh(${JSON.stringify(pathToFileURL(installedEntry).href)}),
});
process.stdout.write(JSON.stringify(snapshot) + "\\n", () => process.exit(0));
`,
	);
	const snapshot = parseJson(
		execFileSync(
			process.execPath,
			["--experimental-strip-types", "--no-warnings", "schema-capture.ts"],
			{ cwd: consumer, env, encoding: "utf8", timeout: 120_000 },
		),
		"the installed schema capture",
	);
	assert.deepEqual(
		snapshot,
		parseJson(
			readFileSync(
				join(root, "test/fixtures/tool-schema/current.json"),
				"utf8",
			),
			"the tool-schema fixture",
		),
	);
	console.log(
		"Installed createPiExtension: per-load registrations equal the source factory and H1's pinned parent/child/deny-tool contract plus the fork's recorded deltas (one registration each, host renderers only through the hook), each load re-reads config, the shipped config example resolves under dist/, and the installed factory plus child entry reproduce test/fixtures/tool-schema/current.json.",
	);
}

try {
	const candidate = process.argv[2] ? resolve(process.argv[2]) : undefined;
	if (candidate)
		writeFileSync(join(fixture, basename(candidate)), readFileSync(candidate));
	else run("npm", ["pack", "--pack-destination", fixture, "--silent"], root);
	const tarballs = readdirSync(fixture).filter((path) => path.endsWith(".tgz"));
	assert.equal(tarballs.length, 1);
	writeFileSync(
		join(fixture, "package.json"),
		JSON.stringify({ private: true, type: "module" }),
	);
	run("npm", [
		"install",
		"--ignore-scripts",
		"--omit=peer",
		"--offline",
		"--no-audit",
		"--no-fund",
		join(fixture, tarballs[0]),
	]);
	const installed = join(fixture, "node_modules/@nubl/maestro");
	assert(!existsSync(join(fixture, "node_modules/@earendil-works")));
	assert(!existsSync(join(fixture, "node_modules/@sinclair")));
	assert.equal(
		readFileSync(join(installed, "LICENSE"), "utf8"),
		readFileSync(join(root, "LICENSE"), "utf8"),
	);
	assert.deepEqual(readdirSync(installed).sort(), [
		"LICENSE",
		"README.md",
		"dist",
		"package.json",
	]);
	assert(existsSync(join(installed, "dist/maestro/engine.js")));
	assert(!existsSync(join(installed, "test")));
	// The root is the engine entry (M6 removed the placeholder API).
	const sourceMap = JSON.parse(
		readFileSync(join(installed, "dist/maestro/engine.js.map"), "utf8"),
	);
	assert.deepEqual(sourceMap.sources, ["../../maestro/engine.ts"]);
	assert.deepEqual(sourceMap.sourcesContent, [
		readFileSync(join(root, "maestro/engine.ts"), "utf8"),
	]);
	assert(!existsSync(join(installed, "dist/index.js")));
	assert.match(
		readFileSync(join(installed, "dist/maestro/engine.d.ts"), "utf8"),
		/export \{ defaultRetainSurface \}/,
	);
	// The candidate records its extraction pin for the consumer's H2 gate.
	const manifest = parseJson(
		readFileSync(join(root, "provenance/copy-manifest.json"), "utf8"),
		"the copy manifest",
	);
	assert.deepEqual(
		parseJson(
			readFileSync(join(installed, "dist/provenance.json"), "utf8"),
			"the packed provenance",
		),
		{
			source_repository: "giuseppecrj/pi-herdr-agents",
			base_main_sha: manifest.base_main_sha,
			copy_sha: manifest.copy_sha,
		},
	);
	// Exports whose emitted closure imports a host-provided Pi/TypeBox peer.
	const installedPkg = JSON.parse(
		readFileSync(join(installed, "package.json"), "utf8"),
	);
	const piExports = Object.keys(installedPkg.exports).filter(
		(name) =>
			name !== "./package.json" &&
			peerImports(join(installed, installedPkg.exports[name].import)).size > 0,
	);
	assert(piExports.includes("./runtime"));
	assert(piExports.includes("./pi/child"));
	assert(!piExports.includes("."));
	assert(!piExports.includes("./engine"));
	assert(!piExports.includes("./testing"));
	// Exports whose JS or declarations need the peers: a peer-free TypeScript
	// consumer cannot typecheck them; a host with the peers typechecks them all.
	const typeExports = Object.keys(installedPkg.exports).filter(
		(name) =>
			name !== "./package.json" &&
			(piExports.includes(name) ||
				declarationPeers(join(installed, installedPkg.exports[name].types))
					.size > 0),
	);
	assert(!typeExports.includes("."));
	assert(!typeExports.includes("./engine"));
	assert(!typeExports.includes("./testing"));
	writeFileSync(join(fixture, "pi-exports.json"), JSON.stringify(piExports));
	writeFileSync(
		join(fixture, "consumer.js"),
		`
import assert from "node:assert/strict";
import piExports from "./pi-exports.json" with { type: "json" };
import * as root from "@nubl/maestro";
import * as engine from "@nubl/maestro/engine";
import pkg from "@nubl/maestro/package.json" with { type: "json" };
assert.deepEqual(Object.keys(root).sort(), Object.keys(engine).sort());
assert.equal(root.createRunSession, engine.createRunSession);
assert.equal("version" in root, false);
assert(pkg.exports["./engine"]);
assert(pkg.exports["./testing"]);
assert(!Object.keys(pkg.exports).some(name => name.includes("*")));
assert.equal(pkg.pi, undefined);
assert.equal(pkg.dependencies, undefined);
for (const name of Object.keys(pkg.exports)) {
 const specifier = name === "." ? "@nubl/maestro" : "@nubl/maestro/" + name.slice(2);
 assert(import.meta.resolve(specifier).includes("node_modules/@nubl/maestro/"));
 if (piExports.includes(name)) {
  // Pi entries require the optional host peers; the engine-only install has none.
  await assert.rejects(import(specifier), (error) => error.code === "ERR_MODULE_NOT_FOUND" && /@earendil-works[/]pi-|@sinclair[/]typebox/.test(error.message));
  continue;
 }
 await import(specifier, name === "./package.json" ? { with: { type: "json" } } : undefined);
}
assert(!process.execArgv.some(arg => /loader|strip-types|import/.test(arg)));
const { createRunSession, defaultRetainSurface } = await import("@nubl/maestro/engine");
const { FakeHarnessAdapter, FakeSurfaceProvider, registerHarnessAdapterConformance, registerSurfaceProviderConformance } = await import("@nubl/maestro/testing");
assert.equal(typeof defaultRetainSurface, "function");
assert.equal(typeof registerHarnessAdapterConformance, "function");
assert.equal(typeof registerSurfaceProviderConformance, "function");
assert.equal(new FakeSurfaceProvider().isAvailable(), true);
const adapter = new FakeHarnessAdapter();
const role = { name: "fixture", version: "1", description: "fixture", systemPrompt: "fixture", allowedTools: [] };
const task = { id: "fixture", name: "fixture", prompt: "fixture", role: "fixture", cwd: process.cwd() };
const session = createRunSession({ adapter, roles: [role], cwd: process.cwd() });
const handle = await session.spawn(task);
const completion = session.supervise(handle, task);
adapter.complete(handle.id, { reason: "done", exitCode: 0 });
assert.equal((await completion).outcome, "completed");
`,
	);
	run(process.execPath, ["consumer.js"]);
	// Explicit development-only Node types; no Pi peers or source TS fallbacks.
	mkdirSync(join(fixture, "node_modules/@types"), { recursive: true });
	cpSync(
		join(root, "node_modules/@types/node"),
		join(fixture, "node_modules/@types/node"),
		{ recursive: true },
	);
	cpSync(
		join(root, "node_modules/undici-types"),
		join(fixture, "node_modules/undici-types"),
		{ recursive: true },
	);
	const pkg = JSON.parse(readFileSync(join(installed, "package.json"), "utf8"));
	const imports = Object.keys(pkg.exports)
		.filter((name) => name !== "./package.json" && !typeExports.includes(name))
		.map(
			(name, index) =>
				`import * as entry${index} from ${JSON.stringify(name === "." ? "@nubl/maestro" : "@nubl/maestro/" + name.slice(2))};\nvoid entry${index};`,
		)
		.join("\n");
	writeFileSync(
		join(fixture, "consumer.ts"),
		imports +
			'\nimport { createRunSession, type RunSession, type RunResult } from "@nubl/maestro/engine";\nimport { FakeHarnessAdapter } from "@nubl/maestro/testing";\nconst role = { name: "fixture", version: "1", description: "fixture", systemPrompt: "fixture", allowedTools: [] };\nconst session: RunSession = createRunSession({ adapter: new FakeHarnessAdapter(), roles: [role], cwd: "/fixture" });\nasync function consume(): Promise<RunResult> { const task = { id: "fixture", name: "fixture", prompt: "fixture", role: "fixture", cwd: "/fixture" }; return session.supervise(await session.spawn(task), task); }\nvoid consume;\n',
	);
	writeFileSync(
		join(fixture, "tsconfig.json"),
		JSON.stringify({
			compilerOptions: {
				strict: true,
				noEmit: true,
				module: "nodenext",
				target: "es2023",
				types: ["node"],
				skipLibCheck: false,
			},
			files: ["consumer.ts"],
		}),
	);
	run(process.execPath, [
		join(root, "node_modules/typescript/bin/tsc"),
		"-p",
		"tsconfig.json",
	]);
	console.log(
		`Packed JS generic-owner lifecycle, ${Object.keys(pkg.exports).length} finite exports (${piExports.length} Pi entries refuse without peers; ${typeExports.length} need peer types), peer-free strict Promise consumer (Node dev types supplied), maps, license and discovery allowlist: passed.`,
	);
	piConsumer(fixture, join(fixture, tarballs[0]), piExports, typeExports);
} finally {
	rmSync(fixture, { recursive: true, force: true });
}
