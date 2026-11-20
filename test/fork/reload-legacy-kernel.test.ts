import assert from "node:assert/strict";
import { test } from "node:test";
import * as runtime from "../../maestro/runtime/index.ts";
import type { SpawnOptions } from "../../maestro/core/harness-adapter.ts";
import { fixture } from "./pi-run-session-fixture.ts";

test("a reload that adopts a kernel which passes no cancel signal still launches", () =>
	fixture(async (f) => {
		// A coordinator built before the kernel passed `cancelled` (d027daa)
		// survives /reload: the new facade must not read `.aborted` off nothing.
		const key = Symbol.for("pi-herdr-agents/PiRunSession-owner");
		// SAFETY: the production factory attaches this known private owner symbol.
		const owner = (
			f.session as runtime.PiRunSession & {
				[key: symbol]: { kernel: runtime.RunSession };
			}
		)[key];
		const kernel = owner.kernel;
		owner.kernel = {
			...kernel,
			spawn(task, prepared) {
				assert.ok(prepared);
				const current = prepared;
				// SAFETY: models the pre-d027daa kernel, whose call had no third argument.
				const legacy = current.spawnAttempt as (
					options: SpawnOptions,
					index: number,
				) => ReturnType<typeof current.spawnAttempt>;
				return kernel.spawn(task, {
					...current,
					spawnAttempt: (options, index) => legacy(options, index),
				});
			},
		};
		const session = runtime.createDefaultRunSession(f.options, f.session);
		const input = f.input("pre-signal-kernel");
		let seen: AbortSignal | undefined;
		const handle = await session.spawnPi({
			...input,
			prepareAttempt: (_index, cancelled) => {
				seen = cancelled;
				return { ...input, snapshot: f.options.getLaunchSnapshot() };
			},
		});
		assert.ok(handle.id);
		assert.ok(f.latest());
		assert.equal(seen?.aborted, false);
	}));
