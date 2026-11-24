import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync, gunzipSync } from "node:zlib";
import {
	checkTestMigration,
	type ForkTestChange,
} from "./check-test-migration.ts";

interface Identity {
	type: string;
	kind: string;
	file: string;
	line: number;
	name: string;
	nesting: number;
	testId: number;
	parentId: number;
	skip: boolean | string;
	todo: boolean | string;
	titles?: string[];
}
/**
 * weihung fork: a migrated Linux-only case that skips on another host. The
 * identity baseline ran on Linux, so the case compares there as unskipped.
 */
interface PlatformSkip {
	platform: NodeJS.Platform;
	destination: string;
	titles: string[];
	/** The exact skip value the case reports on `platform`. */
	skip: true | string;
	reason: string;
}
interface CoverageFile {
	path: string;
	lines: { line: number; count: number }[];
}
interface ReportEvent extends Identity {
	files?: CoverageFile[];
	data?: {
		file?: string;
		success: boolean;
		counts: { tests: number; passed: number; failed: number; skipped: number };
	};
}
interface OriginalFile {
	source: string;
	population: string;
	line: number;
	total_lines: number;
	current_owner: string;
	split_line_map: {
		source_start: number;
		source_end: number;
		destination: string;
		destination_start: number;
	}[];
}

const root = fileURLToPath(new URL("../", import.meta.url));
/** The upstream main the copies were re-baselined on (not the H1 copy pin). */
function baseMainSha(): string {
	try {
		return JSON.parse(
			readFileSync(
				new URL("../provenance/copy-manifest.json", import.meta.url),
				"utf8",
			),
		).base_main_sha;
	} catch (cause) {
		throw new Error("Cannot read the copy manifest", { cause });
	}
}
const coverage = process.argv.includes("--coverage");
const migration = checkTestMigration(root);
let manifest: { maestro_unit_entries: string[] };
try {
	manifest = JSON.parse(
		readFileSync(
			new URL("../provenance/test-manifest.json", import.meta.url),
			"utf8",
		),
	);
} catch (cause) {
	throw new Error("Cannot read unit-entry manifest", { cause });
}
mkdirSync(join(root, "evidence"), { recursive: true });
assert(
	manifest.maestro_unit_entries.length ===
		new Set(manifest.maestro_unit_entries).size,
);
const evidence = mkdtempSync(join(root, "evidence/unit-run-"));
const home = mkdtempSync(join(tmpdir(), "maestro-unit-home-"));
const args = ["--experimental-strip-types", "--enable-source-maps"];
if (coverage)
	args.push(
		"--experimental-test-coverage",
		"--test-coverage-include=maestro/**",
		"--test-coverage-include=pi-extension/**",
	);
args.push(
	"--test",
	"--test-reporter=tap",
	`--test-reporter-destination=${join(evidence, "tests.tap")}`,
	"--test-reporter=./scripts/baseline-reporter.ts",
	`--test-reporter-destination=${join(evidence, "events.jsonl")}`,
	...manifest.maestro_unit_entries,
);
try {
	const env: NodeJS.ProcessEnv = {
		PATH: process.env.PATH,
		HOME: home,
		TMPDIR: tmpdir(),
		PI_CODING_AGENT_DIR: join(home, "agent"),
		npm_config_cache: join(home, "npm-cache"),
	};
	if (coverage) env.NODE_V8_COVERAGE = join(evidence, "v8");
	const result = spawnSync(process.execPath, args, {
		cwd: root,
		env,
		encoding: "utf8",
	});
	writeFileSync(join(evidence, "stderr.log"), result.stderr ?? "");
	writeFileSync(
		join(evidence, "exit.json"),
		JSON.stringify(
			{
				node: process.version,
				status: result.status,
				error: result.error?.message,
				coverage,
				entries: manifest.maestro_unit_entries,
			},
			null,
			"\t",
		) + "\n",
	);
	assert.equal(
		result.status,
		0,
		`Unit tests failed; see ${evidence}/tests.tap and stderr.log`,
	);
	const events: ReportEvent[] = readFileSync(
		join(evidence, "events.jsonl"),
		"utf8",
	)
		.trim()
		.split("\n")
		.map((line) => JSON.parse(line));
	const summary = events.find(
		(e) => e.type === "test:summary" && !e.data?.file,
	)?.data;
	assert(summary?.success);
	const baseline: Identity[] = JSON.parse(
		gunzipSync(
			readFileSync(
				new URL(
					"../provenance/baseline/test-identities.json.gz",
					import.meta.url,
				),
			),
		).toString("utf8"),
	);
	const observed = events.filter(
		(e) => e.type === "test:pass" || e.type === "test:fail",
	);
	const byId = new Map(
		observed.map((e) => [JSON.stringify([e.file, e.testId]), e]),
	);
	for (const event of observed) {
		const titles: string[] = [];
		let current: Identity | undefined = event;
		while (current) {
			titles.unshift(current.name);
			current = current.parentId
				? byId.get(JSON.stringify([current.file, current.parentId]))
				: undefined;
		}
		assert.equal(
			titles.length,
			event.nesting + 1,
			`Incomplete lineage: ${event.file}:${event.line}`,
		);
		event.titles = titles;
	}
	const expectedLeaves = baseline.filter((event) => {
		if (event.kind === "suite") return false;
		if (event.file.endsWith(".conformance.ts"))
			return event.titles?.[0].startsWith("Fake");
		// Baseline identities carry identity-pin lines; use that blob's anchors when the pin moved.
		return migration.files
			.filter((entry) => entry.source === event.file)
			.some((entry) => {
				const original = readFileSync(
					resolve(root, entry.baseline_archive ?? entry.archive),
					"utf8",
				);
				const position = original
					.split("\n")
					.slice(0, event.line - 1)
					.reduce((n, line) => n + line.length + 1, 0);
				return entry.selections.some((range) => {
					if (range.added) return false;
					const start = entry.baseline_archive
						? (range.baseline_start ?? -1)
						: range.start;
					const end = entry.baseline_archive
						? (range.baseline_end ?? -1)
						: range.end;
					return (
						position >= original.lastIndexOf("\n", start - 1) + 1 &&
						position < end
					);
				});
			});
	});
	// Cases added upstream after the identity baseline (drift carried at this pin).
	const added = migration.files.flatMap((entry) =>
		entry.selections
			.filter((range) => range.added)
			.map((range) => ({ file: entry.source, titles: range.titles })),
	);
	const sourceFor = new Map(
		migration.files.map((e) => [e.destination, e.source]),
	);
	sourceFor.set(
		"maestro/testing/harness-adapter.conformance.ts",
		"test/maestro/harness-adapter.conformance.ts",
	);
	sourceFor.set(
		"maestro/testing/surface-provider.conformance.ts",
		"test/maestro/surface-provider.conformance.ts",
	);
	const key = (e: Identity, file = e.file) =>
		JSON.stringify([file, e.titles, e.skip, e.todo]);
	const expectedKeys = [
		...expectedLeaves.map((e) => key(e)),
		...added.map((e) => JSON.stringify([e.file, e.titles, false, false])),
	].sort();
	// weihung fork: a migrated case the fork renamed keeps its upstream identity.
	const forkPath = new URL(
		"../provenance/fork-test-changes.json",
		import.meta.url,
	);
	const renames: ForkTestChange[] = existsSync(forkPath)
		? JSON.parse(readFileSync(forkPath, "utf8")).filter(
				(change: ForkTestChange) => change.renamed_to,
			)
		: [];
	for (const event of observed)
		event.titles = event.titles?.map(
			(title) =>
				renames.find(
					(change) =>
						change.destination === event.file && change.renamed_to === title,
				)?.title ?? title,
		);
	// weihung fork: each recorded platform skip must be observed exactly as
	// recorded (a stale or changed record fails); only it compares unskipped.
	const platformPath = new URL(
		"../provenance/platform-skips.json",
		import.meta.url,
	);
	const platformSkips: PlatformSkip[] = existsSync(platformPath)
		? JSON.parse(readFileSync(platformPath, "utf8"))
		: [];
	for (const entry of platformSkips) {
		assert(
			entry.reason && sourceFor.has(entry.destination),
			`Platform skip needs a reason and a migrated destination: ${entry.destination}`,
		);
		if (entry.platform !== process.platform) continue;
		const matches = observed.filter(
			(event) =>
				event.kind !== "suite" &&
				event.file === entry.destination &&
				JSON.stringify(event.titles) === JSON.stringify(entry.titles) &&
				event.skip === entry.skip,
		);
		assert.equal(
			matches.length,
			1,
			`Stale platform skip: ${entry.platform} ${entry.destination} ${entry.titles.join(" > ")}`,
		);
		matches[0].skip = false;
	}
	const migrated = observed.filter(
		(e) => e.kind !== "suite" && sourceFor.has(e.file),
	);
	assert.deepEqual(
		migrated.map((e) => key(e, sourceFor.get(e.file))).sort(),
		expectedKeys,
		"Migrated identities/titles/skip statuses differ from pinned original cohort",
	);
	const selected = new Set(expectedKeys);
	const identities = baseline.map((event) => {
		const counterpart =
			event.kind !== "suite" && selected.has(key(event))
				? migrated.find((e) => key(e, sourceFor.get(e.file)) === key(event))
				: undefined;
		return {
			...event,
			owner: counterpart ? "@nubl/maestro" : "pi-herdr-agents",
			destination: counterpart?.file ?? event.file,
			migration_status: counterpart ? "verified" : "retained",
			counterpart: counterpart
				? {
						file: counterpart.file,
						line: counterpart.line,
						outcome: counterpart.type,
					}
				: undefined,
		};
	});
	writeFileSync(
		join(evidence, "identities.json.gz"),
		gzipSync(JSON.stringify(identities)),
	);
	// M4 completes the ownership ledger: every original identity that stays
	// upstream carries a reason (scripts/retained-ledger.ts), and the committed
	// ledger names exactly the identities this run leaves upstream.
	let ledger: (Identity & { file: string; reason: string })[];
	try {
		ledger = JSON.parse(
			readFileSync(
				new URL("../provenance/m4/retained-ledger.json", import.meta.url),
				"utf8",
			),
		);
	} catch (cause) {
		throw new Error("Cannot read the retained-identity ledger", { cause });
	}
	assert(ledger.every((entry) => entry.reason.trim().length > 0));
	assert.deepEqual(
		ledger.map((entry) => key(entry)).sort(),
		identities
			.filter(
				(event) => event.kind !== "suite" && event.owner === "pi-herdr-agents",
			)
			.map((event) => key(event))
			.sort(),
		"Retained identities differ from provenance/m4/retained-ledger.json",
	);
	console.log(
		`Unit tests: ${summary.counts.passed}/${summary.counts.tests} passed, ${summary.counts.skipped} skipped. ${migrated.length - added.length} original test identities preserved (+${added.length} added upstream after the identity baseline); ${1769 - migrated.length + added.length} remain upstream.`,
	);
	if (coverage) {
		const baselineCoverage: { original_files: OriginalFile[] } = JSON.parse(
			readFileSync(
				new URL("../provenance/coverage-manifest.json", import.meta.url),
				"utf8",
			),
		);
		const files = events.find((e) => e.type === "test:coverage")?.files;
		assert(files);
		writeFileSync(
			join(evidence, "coverage.json.gz"),
			gzipSync(JSON.stringify(files)),
		);
		const baselineFiles: CoverageFile[] = JSON.parse(
			gunzipSync(
				readFileSync(
					new URL("../provenance/baseline/coverage.json.gz", import.meta.url),
				),
			).toString("utf8"),
		).files;
		/** Union line hits across reload-query variants of one path. */
		const hits = (population: CoverageFile[], path: string) => {
			const lines = new Map<number, number>();
			for (const variant of population.filter((f) => f.path === path))
				for (const line of variant.lines)
					lines.set(line.line, Math.max(lines.get(line.line) ?? 0, line.count));
			return lines;
		};
		const owned = baselineCoverage.original_files.filter(
			(f) => f.current_owner === "@nubl/maestro",
		);
		const failures: string[] = [];
		const reports = owned.map((original) => {
			const before = hits(baselineFiles, original.source);
			assert.equal(before.size, original.total_lines, original.source);
			// Original lines carried byte-identically (or re-indented) into the copy.
			const pairs = original.split_line_map.flatMap((range) =>
				Array.from(
					{ length: range.source_end - range.source_start + 1 },
					(_, offset) => ({
						source: range.source_start + offset,
						destination: range.destination,
						line: range.destination_start + offset,
					}),
				),
			);
			assert(pairs.length, `No line map: ${original.source}`);
			const destinations = [...new Set(pairs.map((pair) => pair.destination))];
			const after = new Map(
				destinations.map((path) => [path, hits(files, path)]),
			);
			for (const path of destinations)
				assert(after.get(path)?.size, `Missing coverage: ${path}`);
			const wholeFile = pairs.length === original.total_lines;
			const covered = pairs.filter(
				(pair) => (after.get(pair.destination)?.get(pair.line) ?? 0) > 0,
			).length;
			const percent = (100 * covered) / pairs.length;
			// A whole-file copy keeps the M1 original-file floor exactly; a file changed
			// upstream since the baseline is held to the baseline hit rate on the same lines.
			const floor = wholeFile
				? original.line
				: (100 *
						pairs.filter((pair) => (before.get(pair.source) ?? 0) > 0).length) /
					pairs.length;
			if (percent < floor)
				failures.push(
					`${original.source}: ${percent}% < original-line floor ${floor}%`,
				);
			const destinationLines = destinations.reduce(
				(n, path) => n + (after.get(path)?.size ?? 0),
				0,
			);
			const destinationCovered = destinations.reduce(
				(n, path) =>
					n +
					[...(after.get(path)?.values() ?? [])].filter((count) => count > 0)
						.length,
				0,
			);
			return {
				source: original.source,
				population: original.population,
				covered,
				total: pairs.length,
				line: percent,
				floor,
				original_file_floor: original.line,
				mapped_lines: `${pairs.length}/${original.total_lines}`,
				destination_line: (100 * destinationCovered) / destinationLines,
			};
		});
		writeFileSync(
			join(evidence, "coverage-files.json"),
			JSON.stringify(reports, null, "\t") + "\n",
		);
		assert.deepEqual(failures, [], "Per-file coverage regressed");
		assert.equal(
			reports.length,
			owned.length,
			"Every measured original file now owned here must be accounted for",
		);
		const populations = [...new Set(reports.map((f) => f.population))].map(
			(population) => {
				const cohort = reports.filter((f) => f.population === population);
				return {
					population,
					files: cohort.length,
					arithmetic_line_mean:
						cohort.reduce((n, f) => n + f.line, 0) / cohort.length,
					subset_floor_line_mean:
						cohort.reduce((n, f) => n + f.floor, 0) / cohort.length,
					weighted_line_percent:
						(100 * cohort.reduce((n, f) => n + f.covered, 0)) /
						cohort.reduce((n, f) => n + f.total, 0),
				};
			},
		);
		const report = {
			base_main_sha: baseMainSha(),
			copy_sha: migration.copy_sha,
			node: process.version,
			counts: summary.counts,
			migrated_tests: migrated.length,
			method:
				"Original-file line-hit union mapped through coverage-manifest split_line_map; per-file non-regression (whole-file copies: M1 original-file floor; files changed upstream after the baseline: baseline hit rate on the same mapped lines; destination-file coverage reported). Arithmetic means and weighted ratios reported. Full runtime/surfaces combined gates remain M6/H2.",
			files: reports,
			populations,
		};
		writeFileSync(
			join(evidence, "coverage.json"),
			JSON.stringify(report, null, "\t") + "\n",
		);
		console.log(JSON.stringify(populations, null, 2));
	}
	console.log(`Evidence: ${evidence}`);
} finally {
	rmSync(home, { recursive: true, force: true });
}
