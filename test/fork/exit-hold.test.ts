import "../clean-host-env.ts";
import "../isolated-agent-dir.ts";
import assert from "node:assert/strict";
import {
	existsSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { createEventBus } from "@earendil-works/pi-coding-agent";
import subagentDoneExtension, {
	EXIT_HOLD_CHANNEL,
	isExitHeld,
} from "../../maestro/adapters/pi/child/protocol.ts";
import { createMockExtensionApi } from "../helpers/mock-extension-api.ts";

function withTempDir(run: (dir: string) => void) {
	const dir = realpathSync(mkdtempSync(join(tmpdir(), "subagents-test-")));
	try {
		run(dir);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

function restoreEnvVar(name: string, value: string | undefined) {
	if (value === undefined) delete process.env[name];
	else process.env[name] = value;
}

describe("child exit hold", () => {
	it("asks exit-hold listeners with the settled messages", () => {
		const events = createEventBus();
		const seen: unknown[] = [];
		assert.equal(EXIT_HOLD_CHANNEL, "pi-herdr-agents:exit-hold");
		assert.equal(isExitHeld(events, []), false);
		events.on(EXIT_HOLD_CHANNEL, (probe: any) => {
			seen.push(probe.messages);
			probe.hold = true;
		});
		const messages = [{ role: "assistant", stopReason: "error" }];
		assert.equal(isExitHeld(events, messages), true);
		assert.deepEqual(seen, [messages]);
		assert.equal(isExitHeld(undefined, messages), false);
	});

	it("stays open while a listener holds the exit, then exits on the next settlement", () => {
		withTempDir((dir) => {
			const previousAutoExit = process.env.PI_SUBAGENT_AUTO_EXIT;
			const previousSession = process.env.PI_SUBAGENT_SESSION;
			const sessionFile = join(dir, "child.jsonl");
			process.env.PI_SUBAGENT_AUTO_EXIT = "1";
			process.env.PI_SUBAGENT_SESSION = sessionFile;
			try {
				const { api, eventHandlers } = createMockExtensionApi();
				subagentDoneExtension(api);
				api.events.on(EXIT_HOLD_CHANNEL, (probe: any) => {
					const last = probe.messages?.at(-1);
					if (last?.errorMessage?.startsWith("Claude quota exceeded"))
						probe.hold = true;
				});
				const quota = {
					role: "assistant",
					stopReason: "error",
					errorMessage: "Claude quota exceeded — rate limit (five_hour)",
				};
				const done = { role: "assistant", stopReason: "stop" };
				let branch: any[] = [quota];
				let shutdowns = 0;
				const ctx = {
					shutdown: () => shutdowns++,
					sessionManager: {
						getBranch: () =>
							branch.map((message) => ({ type: "message", message })),
					},
				};

				eventHandlers.get("agent_end")?.[0]({ messages: [quota] }, ctx);
				eventHandlers.get("agent_settled")?.[0]({ aborted: false }, ctx);
				assert.equal(existsSync(`${sessionFile}.exit`), false);
				assert.equal(shutdowns, 0);

				branch = [quota, done];
				eventHandlers.get("agent_end")?.[0]({ messages: [done] }, ctx);
				eventHandlers.get("agent_settled")?.[0]({ aborted: false }, ctx);
				assert.deepEqual(
					JSON.parse(readFileSync(`${sessionFile}.exit`, "utf8")),
					{ type: "done" },
				);
				assert.equal(shutdowns, 1);
			} finally {
				restoreEnvVar("PI_SUBAGENT_AUTO_EXIT", previousAutoExit);
				restoreEnvVar("PI_SUBAGENT_SESSION", previousSession);
			}
		});
	});
});
