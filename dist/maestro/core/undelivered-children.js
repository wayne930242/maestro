/**
 * The process-local slot that holds this process's running-subagent registry.
 * The subagents extension owns and writes it; the child protocol extension
 * only reads it, so both agree on one key without importing each other.
 */
export const SUBAGENT_RUNTIME_KEY = Symbol.for("pi-subagents/runtime");
function readRuntimeSlot() {
    // SAFETY: `globalThis` has no index signature for this symbol key; the
    // subagents extension is its only writer and stores a `runningSubagents` map.
    const global = globalThis;
    return global[SUBAGENT_RUNTIME_KEY];
}
/**
 * Whether this process launched an ordinary child whose result, help request,
 * or cancellation has not yet been delivered to it.
 *
 * Ordinary completion removes a row just before it sends the result steer, so
 * a row that is still present has not been delivered. A suppressed row will
 * never be delivered and does not count. Persistent specialists stay in the
 * registry by design until they are stopped, so they never count.
 */
export function hasUndeliveredChildren(slot = readRuntimeSlot()) {
    for (const row of slot?.runningSubagents?.values() ?? []) {
        if (row.persistent)
            continue;
        if ((row.lifecycle?.delivery ?? "pending") === "pending")
            return true;
    }
    return false;
}
//# sourceMappingURL=undelivered-children.js.map