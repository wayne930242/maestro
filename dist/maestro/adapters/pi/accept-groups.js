/**
 * The running accept-check process groups of this process (ADR-0017).
 *
 * Every check `runAcceptCommand` spawns leads its own process group. The
 * runner tracks it here from spawn until it has killed that group, under the
 * owner that stops it at shutdown: the child's accept loop or the parent's
 * run session. An owner's shutdown calls `terminateAcceptChecks`: SIGTERM,
 * SIGKILL after a short grace, awaited, then a synchronous SIGKILL of anything
 * still tracked. A synchronous `exit` hook SIGKILLs every group still tracked
 * when the process exits, as a last resort.
 *
 * The registry lives in a `globalThis` slot, so every loaded copy of this
 * module (an extension reload loads another) shares one set and one hook.
 */
import { ACCEPT_SHUTDOWN_GRACE_MS } from "../../core/accept.js";
import { killProcessTree } from "./process-tree.js";
/** Extra wait, after the shutdown grace, for runners to report their exit. */
const SETTLE_MARGIN_MS = 250;
const SLOT = Symbol.for("pi-herdr-agents/accept-check-groups");
function registry() {
    // SAFETY: `globalThis` has no index signature for this symbol key; this
    // module is its only writer and stores a `Registry`.
    const global = globalThis;
    return (global[SLOT] ??= { checks: new Set(), exitHook: false });
}
function killGroup(check) {
    killProcessTree(check.pgid, "SIGKILL", check.processTree);
}
/** Synchronous, for the `exit` hook: SIGKILL every group still tracked. */
export function killTrackedAcceptChecks() {
    for (const check of registry().checks)
        killGroup(check);
}
/** Track one running check; the returned function untracks it. */
export function trackAcceptCheck(check) {
    const state = registry();
    if (!state.exitHook) {
        state.exitHook = true;
        process.on("exit", killTrackedAcceptChecks);
    }
    state.checks.add(check);
    return () => {
        state.checks.delete(check);
    };
}
/**
 * Stop every check `owner` still runs: SIGTERM now, SIGKILL after `graceMs`,
 * and wait for their runners up to a short margin past that. A group still
 * tracked then is killed synchronously before this returns.
 */
export async function terminateAcceptChecks(owner, graceMs = ACCEPT_SHUTDOWN_GRACE_MS) {
    const { checks } = registry();
    const owned = [...checks].filter((check) => check.owner === owner);
    if (!owned.length)
        return;
    for (const check of owned)
        check.terminate(graceMs);
    let timer;
    await Promise.race([
        Promise.all(owned.map((check) => check.finished)),
        new Promise((resolve) => {
            timer = setTimeout(resolve, graceMs + SETTLE_MARGIN_MS);
        }),
    ]);
    clearTimeout(timer);
    for (const check of owned)
        if (checks.has(check))
            killGroup(check);
}
//# sourceMappingURL=accept-groups.js.map