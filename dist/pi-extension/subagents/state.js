import { SUBAGENT_RUNTIME_KEY } from "../../maestro/core/undelivered-children.js";
// Survive /reload: replace presentation timers while keeping active completion
// watchers and their registry alive. Old module closures continue watching the
// children; the reloaded module adopts the shared registry for status/interrupts.
export const WIDGET_INTERVAL_KEY = Symbol.for("pi-subagents/widget-interval");
export const STATUS_INTERVAL_KEY = Symbol.for("pi-subagents/status-interval");
export const RUNTIME_KEY = SUBAGENT_RUNTIME_KEY;
export function readGlobalSlot(key) {
    // SAFETY: `globalThis` has no index signature for our extension-private
    // symbol keys; only this module ever writes the values read back here.
    return globalThis[key];
}
export function writeGlobalSlot(key, value) {
    // SAFETY: see readGlobalSlot above; this module is the sole writer.
    globalThis[key] = value;
}
/** Bind the live parent API and release every delivery held for it. */
export function bindLiveApi(runtime, api) {
    runtime.liveApi = api;
    runtime.reloadGap = false;
    releaseHeldDeliveries(runtime, api);
}
/**
 * The live parent context for preparing a launch. In a reload gap, wait for the
 * replacement session to bind it; `undefined` means none is coming (the parent
 * quit) or, outside a gap, that none exists.
 */
export async function awaitLiveContext(runtime, id, cancelled) {
    if (runtime.latestCtx || !runtime.reloadGap)
        return runtime.latestCtx;
    // session_start and tool calls set latestCtx before bindLiveApi releases.
    return (await holdDelivery(runtime, id, cancelled))
        ? runtime.latestCtx
        : undefined;
}
/**
 * Wait for the next live parent API; `undefined` means the parent exited or
 * `cancelled` aborted, which ends the wait at once and leaves the queue.
 */
export function holdDelivery(runtime, id, cancelled) {
    return new Promise((resolve) => {
        const held = {
            id,
            release(api) {
                cancelled?.removeEventListener("abort", onCancel);
                resolve(api);
            },
        };
        const onCancel = () => {
            const queue = runtime.heldDeliveries;
            const at = queue?.indexOf(held) ?? -1;
            if (at >= 0)
                queue?.splice(at, 1);
            held.release(undefined);
        };
        if (cancelled?.aborted)
            return resolve(undefined);
        cancelled?.addEventListener("abort", onCancel, { once: true });
        (runtime.heldDeliveries ??= []).push(held);
    });
}
/** Release the current held batch once, in order; failed notices may requeue. */
export function releaseHeldDeliveries(runtime, api) {
    // Include notices collecting asynchronous evidence, not just queued retries.
    if (!api)
        for (const running of runtime.runningSubagents.values())
            running.stopAttempt?.cancelNotice?.();
    for (const held of runtime.heldDeliveries?.splice(0) ?? [])
        held.release(api);
}
/**
 * Any running subagent except a persistent specialist idle between tasks or
 * one whose stop failed, which may never leave the table.
 */
export function hasWorkingSubagents(subagents) {
    for (const running of subagents) {
        if (running.stopState === "failed")
            continue;
        if (running.persistent && !running.taskId && !running.stopState)
            continue;
        return true;
    }
    return false;
}
export function shouldDeliverSubagentCompletion(running) {
    // Authoritative gate: only pending deliveries may be sent.
    return running.lifecycle.delivery === "pending";
}
export function selectCompletionApi(previous, current) {
    return current ?? previous;
}
//# sourceMappingURL=state.js.map