import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readManifest } from "./check-copy-fidelity.ts";

export interface LineRange {
	source_start: number;
	source_end: number;
	destination: string;
	destination_start: number;
}

/**
 * Byte-identical line runs shared by an original file and its copied (or
 * split-out) destination, from a longest-common-subsequence line diff. Lines
 * changed or added upstream after the coverage baseline are deliberately absent.
 */
export function commonLineRanges(
	original: string[],
	copy: string[],
	destination: string,
): LineRange[] {
	const n = original.length;
	const m = copy.length;
	const width = m + 1;
	const table = new Uint32Array((n + 1) * width);
	for (let i = n - 1; i >= 0; i--)
		for (let j = m - 1; j >= 0; j--)
			table[i * width + j] =
				original[i] === copy[j]
					? table[(i + 1) * width + j + 1] + 1
					: Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
	const ranges: LineRange[] = [];
	let i = 0;
	let j = 0;
	while (i < n && j < m) {
		if (original[i] === copy[j]) {
			const last = ranges.at(-1);
			if (
				last &&
				last.source_end === i &&
				last.destination_start + (last.source_end - last.source_start) === j
			)
				last.source_end = i + 1;
			else
				ranges.push({
					source_start: i + 1,
					source_end: i + 1,
					destination,
					destination_start: j + 1,
				});
			i++;
			j++;
		} else if (table[(i + 1) * width + j] >= table[i * width + j + 1]) i++;
		else j++;
	}
	return ranges;
}

/** Indentation-insensitive: H1's split re-indents moved protocol code inside a factory. */
const lines = (text: string) =>
	text
		.replace(/\n$/, "")
		.split("\n")
		.map((line) => line.trim());

if (
	process.argv[1] &&
	resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
	const [upstream, step = "M3"] = process.argv.slice(2);
	assert(
		upstream,
		"Usage: map-coverage-lines.ts <upstream-repository> [step | owned]",
	);
	const root = fileURLToPath(new URL("../", import.meta.url));
	const manifestPath = resolve(root, "provenance/coverage-manifest.json");
	let coverage: {
		base_main_sha: string;
		original_files: {
			source: string;
			current_owner: string;
			split_line_map: LineRange[];
			mapping_status: string;
			total_lines: number;
		}[];
	};
	try {
		coverage = JSON.parse(readFileSync(manifestPath, "utf8"));
	} catch (cause) {
		throw new Error("Cannot read coverage manifest", { cause });
	}
	const copies = readManifest(resolve(root, "provenance/copy-manifest.json"));
	/**
	 * H1 split the child protocol out of the legacy terminal entry, and the
	 * per-load registration (createPiExtension) out of the Pi terminal entry.
	 */
	const splits = new Map([
		[
			"maestro/adapters/pi/child/subagent-done.ts",
			"maestro/adapters/pi/child/protocol.ts",
		],
		["pi-extension/subagents/index.ts", "pi-extension/subagents/extension.ts"],
	]);
	// `owned` re-maps files Maestro already owns whose copy records an owned
	// change, including an original split into a destination that records one.
	const ownedCopies = copies.entries.flatMap((entry) =>
		entry.kind === "copy" && entry.owned_change ? [entry] : [],
	);
	const owned = new Set([
		...ownedCopies.map((entry) => entry.source),
		...[...splits].flatMap(([original, destination]) =>
			ownedCopies.some((entry) => entry.destination === destination)
				? [original]
				: [],
		),
	]);
	for (const original of coverage.original_files) {
		if (
			step === "owned"
				? !owned.has(original.source)
				: original.current_owner === "@nubl/maestro"
		)
			continue;
		const destination =
			splits.get(original.source) ??
			copies.entries.find(
				(entry) => entry.kind === "copy" && entry.source === original.source,
			)?.destination;
		if (!destination) continue;
		const before = lines(
			execFileSync(
				"git",
				[
					"-C",
					upstream,
					"show",
					`${coverage.base_main_sha}:${original.source}`,
				],
				{ encoding: "utf8" },
			),
		);
		assert.equal(before.length, original.total_lines, original.source);
		const after = lines(readFileSync(resolve(root, destination), "utf8"));
		const ranges = commonLineRanges(before, after, destination);
		const mapped = ranges.reduce(
			(sum, range) => sum + range.source_end - range.source_start + 1,
			0,
		);
		original.current_owner = "@nubl/maestro";
		original.split_line_map = ranges;
		original.mapping_status =
			step === "owned"
				? `Copy from the H1 pin (${destination}) with a recorded owned change after H2; ${mapped}/${before.length} original lines map by indentation-insensitive line diff, ${before.length - mapped} changed or removed after the coverage baseline, ${after.length - mapped} destination lines are post-baseline. Gate: original-floor over mapped lines; post-baseline lines reported.`
				: mapped === before.length && after.length === before.length
					? `${step} whole-file identity copy from the H1 pin; no source lines split or omitted. ${step} per-file gate: scripts/test-unit.ts --coverage.`
					: `${step} copy from the H1 pin (${destination}); ${mapped}/${before.length} original lines map by indentation-insensitive line diff, ${before.length - mapped} changed or removed upstream after the coverage baseline, ${after.length - mapped} destination lines are post-baseline. Gate: original-floor over mapped lines; post-baseline lines reported.`;
		console.log(`${original.source}: ${mapped}/${before.length} mapped`);
	}
	writeFileSync(manifestPath, JSON.stringify(coverage, null, "\t") + "\n");
}
