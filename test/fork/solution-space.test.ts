import assert from "node:assert/strict";
import { test } from "node:test";
import * as runtime from "../../maestro/runtime/index.ts";
import { fixture } from "./pi-run-session-fixture.ts";

test("a task's solutionSpace reaches the child as PI_SUBAGENT_SOLUTION_SPACE", () =>
	fixture(async (f) => {
		f.options.roles.push({
			name: "plain",
			version: "1",
			description: "Plain role",
			systemPrompt: "",
			allowedTools: [],
		});
		const session = runtime.createDefaultRunSession(f.options, f.session);
		await session.spawn({
			id: "with-space",
			name: "with-space",
			prompt: "bounded task",
			role: "plain",
			cwd: f.dir,
			behavior: { solutionSpace: "Cause known; the fix needs one API choice." },
		});
		await session.spawn({
			id: "without-space",
			name: "without-space",
			prompt: "bounded task",
			role: "plain",
			cwd: f.dir,
		});
		assert.match(
			f.commands[0],
			/PI_SUBAGENT_SOLUTION_SPACE='Cause known; the fix needs one API choice\.'/,
		);
		assert.doesNotMatch(f.commands[1], /PI_SUBAGENT_SOLUTION_SPACE/);
	}));
