import "../isolated-agent-dir.ts";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { maestroBuildInfo } from "../../maestro/pi.ts";

const root = fileURLToPath(new URL("../..", import.meta.url)).replace(
	/\/$/,
	"",
);
const pkg = JSON.parse(readFileSync(`${root}/package.json`, "utf8"));

test("maestroBuildInfo names the package version and the root it loaded from", () => {
	assert.deepEqual(maestroBuildInfo(), { version: pkg.version, root });
});

test("maestroBuildInfo returns the same answer on every call", () => {
	assert.equal(maestroBuildInfo(), maestroBuildInfo());
});
