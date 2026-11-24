import assert from "node:assert/strict";
import { test } from "node:test";
import { parsePaneConfig } from "../../maestro/core/config/pane-config.ts";

// weihung fork (8866047): fork-only cases live here, because the migrated
// files are identity-pinned to the upstream cohort.
test("loads a positive safe minimum split size, defaulting to 80", () => {
	assert.equal(parsePaneConfig({}).minSplitCols, 80);
	assert.equal(
		parsePaneConfig({ panes: { minSplitCols: 12 } }).minSplitCols,
		12,
	);
	for (const minSplitCols of [
		0,
		-1,
		1.5,
		"80",
		null,
		Number.MAX_SAFE_INTEGER + 1,
	]) {
		assert.throws(
			() => parsePaneConfig({ panes: { minSplitCols } }),
			/minSplitCols must be a positive safe integer/,
		);
	}
});
