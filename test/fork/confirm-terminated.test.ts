// weihung fork: PiHarnessAdapter.confirmTerminated cases (pi-herdr-agents fork
// 4921564, ec9d0d0).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	alive,
	type Entry,
	fakeProbe,
	identity,
	usingFixture,
	worktreeChild,
} from "./pi-harness-adapter-fixture.ts";

describe("PiHarnessAdapter retained worktree kill (weihung fork)", () => {
	describe("confirmTerminated", () => {
		it("an exited identity is gone, observed without any signal or pane action", async () =>
			usingFixture(async (f) => {
				const { probe, signals } = fakeProbe(new Map<number, Entry>());
				const w = await worktreeChild(f, { probe, identity: identity() });
				assert.equal(await w.adapter.confirmTerminated(w.h), true);
				assert.deepEqual(signals, []);
				assert.deepEqual(w.closes, []);
			}));
		it("an identity known alive is not gone, even when its pane is", async () =>
			usingFixture(async (f) => {
				const { probe, signals } = fakeProbe(new Map([[20, alive()]]));
				const w = await worktreeChild(f, { probe, identity: identity() });
				assert.equal(await w.adapter.confirmTerminated(w.h), false);
				f.surface.removeSurface(w.child.surface);
				assert.equal(await w.adapter.confirmTerminated(w.h), false);
				assert.deepEqual(signals, [], "observation never signals");
			}));
		const unprovenIdentities: Array<[string, Entry]> = [
			["an unreadable identity", "EACCES"],
			["a reused PID", alive("7777")],
		];
		for (const [label, entry] of unprovenIdentities)
			it(`${label} is gone only with its pane`, async () =>
				usingFixture(async (f) => {
					const { probe, signals } = fakeProbe(new Map([[20, entry]]));
					const w = await worktreeChild(f, { probe, identity: identity() });
					assert.equal(await w.adapter.confirmTerminated(w.h), false);
					f.surface.removeSurface(w.child.surface);
					assert.equal(await w.adapter.confirmTerminated(w.h), true);
					assert.deepEqual(signals, []);
				}));
		it("without a captured identity only a gone pane proves it", async () =>
			usingFixture(async (f) => {
				const { probe, signals } = fakeProbe(new Map([[20, alive()]]));
				const w = await worktreeChild(f, {
					probe,
					captureError: "Process identity not captured within 15000ms",
				});
				assert.equal(await w.adapter.confirmTerminated(w.h), false);
				f.surface.removeSurface(w.child.surface);
				assert.equal(await w.adapter.confirmTerminated(w.h), true);
				assert.deepEqual(signals, []);
			}));
		it("judges an identity captured during the pane check, not the stale absence of one", async () =>
			usingFixture(async (f) => {
				const { probe, signals } = fakeProbe(new Map([[20, alive()]]));
				const w = await worktreeChild(f, {
					probe,
					captureError: "Process identity not captured within 15000ms",
				});
				const inspect = f.surface.inspectSurface.bind(f.surface);
				f.surface.removeSurface(w.child.surface);
				f.surface.inspectSurface = async (id) => {
					const result = await inspect(id);
					// The capture lands while Herdr answers that the pane is gone.
					w.child.processIdentity = identity();
					return result;
				};
				assert.equal(await w.adapter.confirmTerminated(w.h), false);
				assert.deepEqual(signals, []);
			}));
		it("its pane check never holds the process open", async () =>
			usingFixture(async (f) => {
				const w = await worktreeChild(f, {
					captureError: "not recorded",
					killTimeoutMs: 40,
				});
				f.surface.inspectSurface = () => new Promise(() => {});
				const timers: Array<ReturnType<typeof setTimeout>> = [];
				const realSetTimeout = globalThis.setTimeout;
				// SAFETY: the wrapper forwards every argument and returns the real timer.
				globalThis.setTimeout = ((...args: Parameters<typeof setTimeout>) => {
					const timer = realSetTimeout(...args);
					timers.push(timer);
					return timer;
				}) as typeof setTimeout;
				let result: Promise<boolean>;
				try {
					// The pane inspection and its deadline timer start synchronously.
					result = w.adapter.confirmTerminated(w.h);
				} finally {
					globalThis.setTimeout = realSetTimeout;
				}
				assert.ok(timers.length > 0, "a deadline timer was armed");
				assert.ok(
					timers.every((timer) => !timer.hasRef()),
					"every timer of the background check is unref'd",
				);
				assert.equal(await result, false);
			}));
		it("an unavailable pane inspection is never gone", async () =>
			usingFixture(async (f) => {
				const w = await worktreeChild(f, { captureError: "not recorded" });
				f.surface.inspectSurface = () => {
					throw new Error("herdr unavailable");
				};
				assert.equal(await w.adapter.confirmTerminated(w.h), false);
			}));
		it("an ordinary child is gone exactly when its pane is; an unknown child is not", async () =>
			usingFixture(async (f) => {
				const w = await worktreeChild(f);
				w.child.worktree = undefined;
				assert.equal(await w.adapter.confirmTerminated(w.h), false);
				f.surface.removeSurface(w.child.surface);
				assert.equal(await w.adapter.confirmTerminated(w.h), true);
				assert.equal(
					await w.adapter.confirmTerminated({ ...w.h, id: "unknown" }),
					false,
				);
				assert.deepEqual(w.closes, []);
			}));
	});
});
