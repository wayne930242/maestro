// weihung fork: resume keeps the launch's system prompt (pi-herdr-agents fork
// 798f07a), so a resumed child's prompt cache stays valid.
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { describe, it } from "node:test";
import { usingFixture } from "./pi-harness-adapter-fixture.ts";

describe("PiHarnessAdapter (weihung fork: resume system prompt)", () => {
	for (const mode of ["append", "replace"] as const)
		it(`resume passes the launch's ${mode} system prompt again, with the same content`, async () =>
			usingFixture(async (f) => {
				const commands: string[] = [];
				f.operations.runScript = (_surface, value, options) => {
					commands.push(value);
					return options.scriptPath;
				};
				const flag =
					mode === "replace" ? "--system-prompt" : "--append-system-prompt";
				const h = await f.adapter.spawn({
					...f.options,
					systemPrompt: "Stable identity addendum",
					role: {
						...f.options.role,
						defaults: {
							...f.options.role.defaults,
							systemPromptMode: mode,
						},
					},
				});
				const re = new RegExp(`${flag} '([^']+)'`);
				assert.ok(re.test(commands.at(-1) ?? ""));
				writeFileSync(
					h.sessionId,
					JSON.stringify({
						type: "session",
						version: 3,
						id: h.id,
						cwd: f.root,
					}) + "\n",
				);
				await f.adapter.kill(h);
				await f.adapter.resume({ name: "resumed", sessionId: h.sessionId });
				const path = (commands.at(-1) ?? "").match(re)?.[1];
				assert.ok(path, "resume must pass the system prompt flag");
				assert.equal(readFileSync(path, "utf8"), "Stable identity addendum");
			}));
});
