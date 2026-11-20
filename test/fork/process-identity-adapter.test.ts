import assert from "node:assert/strict";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
	alive,
	fakeProbe,
	usingFixture,
	worktreeChild,
} from "./pi-harness-adapter-fixture.ts";

describe("PiHarnessAdapter retained worktree kill (weihung fork: identity capture)", () => {
	it("a restarted capture still pending names why the previous attempt failed", async () =>
		usingFixture(async (f) => {
			const { probe, signals } = fakeProbe(new Map([[20, alive()]]));
			const w = await worktreeChild(f, {
				probe,
				captureError:
					"Process identity not captured within 15000ms: the child has not recorded its process identity",
			});
			w.child.processIdentityFile = join(f.root, "late.process.json");
			f.operations.captureProcessIdentity = () => new Promise(() => {});
			await assert.rejects(
				w.adapter.kill(w.h),
				/identity capture is still pending; the previous attempt failed: Process identity not captured within 15000ms: the child has not recorded/,
			);
			assert.deepEqual(signals, []);
		}));
});
