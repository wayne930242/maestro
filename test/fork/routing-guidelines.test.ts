import "../isolated-agent-dir.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import {
	buildSubagentRoutingGuidelines,
	SubagentParams,
} from "../../pi-extension/subagents/catalog.ts";

const tasks = { coding: ["test/one"] };

test("task-category guideline names solutionSpace as a reason to omit thinking", () => {
	assert.match(
		buildSubagentRoutingGuidelines("catalog", tasks).join("\n"),
		/or when you pass solutionSpace, from which an installed extension may set the child's level/,
	);
});

test("guidelines and parameters state how an omitted model and thinking resolve", () => {
	for (const preferences of [tasks, undefined])
		assert.match(
			buildSubagentRoutingGuidelines("catalog", preferences).join("\n"),
			/Omitting model uses the role's model, then the configured models\.agents entry and models\.default, and only then the parent model\. Omitting thinking uses task-category thinking, then the role's thinking, otherwise the parent level, which an installed extension may replace from solutionSpace\./,
		);
	// SAFETY: SubagentParams is a TypeBox object; model and thinking are schemas with a description.
	const properties = SubagentParams.properties as Record<
		string,
		{ description?: string; anyOf?: unknown[] }
	>;
	assert.match(
		properties.model.description ?? "",
		/Omitting uses the role's model, then the configured models\.agents entry and models\.default, then the parent model\./,
	);
	assert.match(
		JSON.stringify(properties.thinking),
		/an installed extension may set the child's level from solutionSpace instead/,
	);
});
