import assert from "node:assert/strict";
import { test } from "node:test";
import {
	TASK_CATEGORIES,
	TASK_CATEGORY_DESCRIPTIONS,
} from "../../maestro/core/config/task-model-types.ts";

test("complex-coding is a task category right after coding", () => {
	assert.deepEqual(TASK_CATEGORIES.slice(0, 2), ["coding", "complex-coding"]);
	assert.equal(
		TASK_CATEGORY_DESCRIPTIONS["complex-coding"],
		"Complex or high-risk implementation workers",
	);
});
