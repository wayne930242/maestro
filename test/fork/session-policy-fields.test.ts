import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
	getSubagentSessionPolicyFile,
	readSubagentSessionPolicy,
	writeSubagentSessionPolicy,
} from "../../maestro/adapters/pi/session.ts";

// weihung fork: no migrated case saves a malformed agent or self-spawn field,
// so these refusals were never run. V8 sometimes reported their lines as
// covered anyway, which left the session.ts coverage floor to chance.
test("a saved policy with a malformed agent or self-spawn field fails closed before its hash", (t) => {
	const dir = mkdtempSync(join(tmpdir(), "policy-fields-"));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	const sessionFile = join(dir, "child.jsonl");
	const saved = writeSubagentSessionPolicy(sessionFile, {
		owner: "public",
		deniedTools: [],
		agent: "worker",
		selfSpawn: false,
	});
	const read = readSubagentSessionPolicy(sessionFile);
	assert.equal(read.version === 2 && read.agent, "worker");
	for (const [field, value, refusal] of [
		["agent", 42, /the saved launch agent policy is malformed/],
		["selfSpawn", "yes", /the saved launch self-spawn policy is malformed/],
	] as const) {
		writeFileSync(
			getSubagentSessionPolicyFile(sessionFile),
			JSON.stringify({ ...saved, [field]: value }),
		);
		assert.throws(() => readSubagentSessionPolicy(sessionFile), refusal);
	}
});
