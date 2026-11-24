import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
	checkAdaptedHelper,
	checkTestMigration,
	rewriteResourcePaths,
	tokens,
} from "../scripts/check-test-migration.ts";
import { gitBlob } from "../scripts/check-copy-fidelity.ts";
import {
	checkChildClosure,
	checkEngineClosure,
} from "../scripts/check-boundaries.ts";

test("test migration accepts only trivia changes, never changed assertions or literal contents", (t) => {
	const root = mkdtempSync(join(tmpdir(), "maestro-test-fidelity-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	mkdirSync(join(root, "provenance"));
	const original =
		'import assert from "node:assert/strict";\ntest("case", () => { assert.equal(1, 1); });';
	const blob = gitBlob(Buffer.from(original));
	writeFileSync(join(root, "original.ts"), original);
	writeFileSync(join(root, "migrated.ts"), original);
	writeFileSync(
		join(root, "provenance/upstream-tree.json"),
		JSON.stringify({
			copy_sha: "fixture",
			files: [{ path: "source.ts", blob }],
		}),
	);
	writeFileSync(
		join(root, "provenance/m2-test-map.json"),
		JSON.stringify({
			copy_sha: "fixture",
			files: [
				{
					source: "source.ts",
					destination: "migrated.ts",
					archive: "original.ts",
					blob,
					whole: true,
					selections: [
						{ start: original.indexOf('test("case"'), end: original.length },
					],
					helpers: [],
				},
			],
		}),
	);
	assert.equal(checkTestMigration(root).files.length, 1);
	writeFileSync(join(root, "migrated.ts"), original.replace("1, 1", "1, 2"));
	assert.throws(() => checkTestMigration(root), /Changed or missing/);
	writeFileSync(
		join(root, "migrated.ts"),
		original.replace("node:assert/strict", "./noop.ts"),
	);
	assert.throws(() => checkTestMigration(root), /Unmapped test import/);
	assert.notEqual(
		tokens("`prefix ${value} a b`"),
		tokens("`prefix ${value} ab`"),
	);
	writeFileSync(join(root, "engine.ts"), 'export * from "./inner.ts";');
	writeFileSync(
		join(root, "inner.ts"),
		'import type { Model } from "@earendil-works/pi-ai";',
	);
	assert.throws(
		() => checkEngineClosure(join(root, "engine.ts")),
		/Pi dependency in engine closure/,
	);
	assert.notEqual(
		tokens('assert.equal("a b", "a b")'),
		tokens('assert.equal("ab", "a b")'),
	);
	assert.equal(
		tokens("assert.equal(1, 1)"),
		tokens("assert . equal ( 1,\n1 )"),
	);
});

test("weihung fork: a recorded case of a whole-file migration may change only its own body, in place", (t) => {
	const root = mkdtempSync(join(tmpdir(), "maestro-fork-whole-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	mkdirSync(join(root, "provenance"));
	const header = 'import assert from "node:assert/strict";\n';
	const kept = 'test("kept", () => { assert.equal(1, 1); });';
	const changed = 'test("changed", () => { assert.equal(2, 2); });';
	const original = `${header}${kept}\n${changed}`;
	const blob = gitBlob(Buffer.from(original));
	writeFileSync(join(root, "original.ts"), original);
	writeFileSync(
		join(root, "provenance/upstream-tree.json"),
		JSON.stringify({
			copy_sha: "fixture",
			files: [{ path: "source.ts", blob }],
		}),
	);
	writeFileSync(
		join(root, "provenance/m2-test-map.json"),
		JSON.stringify({
			copy_sha: "fixture",
			files: [
				{
					source: "source.ts",
					destination: "migrated.ts",
					archive: "original.ts",
					blob,
					whole: true,
					selections: [kept, changed].map((text) => ({
						start: original.indexOf(text),
						end: original.indexOf(text) + text.length,
					})),
					helpers: [],
				},
			],
		}),
	);
	const migrate = (...statements: string[]) =>
		writeFileSync(join(root, "migrated.ts"), header + statements.join("\n"));
	const forked = changed.replace("2, 2", "2, 3");
	migrate(kept, forked);
	assert.throws(() => checkTestMigration(root), /Changed or missing/);
	writeFileSync(
		join(root, "provenance/fork-test-changes.json"),
		JSON.stringify([
			{ destination: "migrated.ts", title: "changed", reason: "fixture" },
		]),
	);
	assert.equal(checkTestMigration(root).files.length, 1);
	// The record waives its own case only, at its own place in the file.
	migrate(kept.replace("1, 1", "1, 2"), forked);
	assert.throws(() => checkTestMigration(root), /Changed or missing/);
	migrate(forked, kept);
	assert.throws(() => checkTestMigration(root), /Changed whole-file/);
	migrate(kept, forked, "const extra = 1;");
	assert.throws(() => checkTestMigration(root), /Changed whole-file/);
	migrate(kept, changed);
	assert.throws(() => checkTestMigration(root), /Stale fork test change/);
});

test("the child entry closure rejects parent runtime, launch, provider and terminal imports", (t) => {
	const root = mkdtempSync(join(tmpdir(), "maestro-child-closure-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	mkdirSync(join(root, "child"));
	writeFileSync(join(root, "child/entry.ts"), 'export * from "./protocol.ts";');
	writeFileSync(
		join(root, "child/protocol.ts"),
		'import { isString } from "../guards.ts";\nvoid isString;',
	);
	writeFileSync(join(root, "guards.ts"), "export const isString = 1;");
	checkChildClosure(join(root, "child/entry.ts"));
	for (const specifier of [
		"../../../runtime/pi-run-session.ts",
		"../launch.ts",
		"../pi-harness-adapter.ts",
		"../../../../pi-extension/subagents/child-widget.ts",
		"@earendil-works/pi-tui",
	]) {
		writeFileSync(
			join(root, "guards.ts"),
			`import ${JSON.stringify(specifier)};`,
		);
		assert.throws(
			() => checkChildClosure(join(root, "child/entry.ts")),
			/Parent\/provider dependency in child closure/,
		);
	}
});

test("an adapted helper may change only its declared statements", (t) => {
	const root = mkdtempSync(join(tmpdir(), "maestro-adapted-helper-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const original =
		'const KEEP = ["A"];\nfunction load() { return "fixed"; }\nexport function run() { return load(); }\n';
	const blob = gitBlob(Buffer.from(original));
	writeFileSync(join(root, "original.ts"), original);
	const helper = {
		source: "helper.ts",
		destination: "adapted.ts",
		archive: "original.ts",
		blob,
		changed: ["run"],
		added: ["entries"],
		reason: "fixture",
	};
	const tree = { files: [{ path: "helper.ts", blob }] };
	const write = (text: string) => writeFileSync(join(root, "adapted.ts"), text);
	write(
		'const KEEP = ["A"];\nfunction load() { return "fixed"; }\nconst entries = { load };\nexport function run(e = entries) { return e.load(); }\n',
	);
	checkAdaptedHelper(root, helper, tree);
	write(
		'const KEEP = ["B"];\nfunction load() { return "fixed"; }\nconst entries = { load };\nexport function run(e = entries) { return e.load(); }\n',
	);
	assert.throws(
		() => checkAdaptedHelper(root, helper, tree),
		/changed an undeclared statement: adapted.ts KEEP/,
	);
	write(
		'const KEEP = ["A"];\nfunction load() { return "fixed"; }\nconst other = 1;\nexport function run() { return load() + other; }\n',
	);
	assert.throws(
		() => checkAdaptedHelper(root, helper, tree),
		/added an undeclared statement: adapted.ts other/,
	);
	assert.throws(
		() =>
			checkAdaptedHelper(root, helper, {
				files: [{ path: "helper.ts", blob: "0".repeat(40) }],
			}),
		/not at the pin/,
	);
});

test("resource mappings rewrite only the mapped path inside dynamic import arguments", () => {
	const mappings = [
		{
			from: "../pi-extension/subagents/index.ts",
			to: "./helpers/pi-extension.ts",
		},
	];
	assert.equal(
		rewriteResourcePaths(
			"const m = await import(`../pi-extension/subagents/index.ts?reload-${n}`);",
			mappings,
		),
		"const m = await import(`./helpers/pi-extension.ts?reload-${n}`);",
	);
	assert.equal(
		rewriteResourcePaths(
			'await import(new URL("../pi-extension/subagents/index.ts?x=1", import.meta.url).href);',
			mappings,
		),
		'await import(new URL("./helpers/pi-extension.ts?x=1", import.meta.url).href);',
	);
	for (const untouched of [
		'readFileSync("../pi-extension/subagents/index.ts");',
		'await import("../pi-extension/subagents/index.tsx");',
		'await import("../pi-extension/subagents/other.ts");',
	])
		assert.equal(rewriteResourcePaths(untouched, mappings), untouched);
});
