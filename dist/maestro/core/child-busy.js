/**
 * Event-bus channel a child asks before it asks itself whether its task is
 * done. A listener that knows the child is still waiting on work of its own,
 * such as running subagents, sets `busy` synchronously.
 */
export const CHILD_BUSY_CHANNEL = "pi-herdr-agents:child-busy";
export function isChildBusy(events) {
    if (!events)
        return false;
    const probe = { busy: false };
    events.emit(CHILD_BUSY_CHANNEL, probe);
    return probe.busy;
}
//# sourceMappingURL=child-busy.js.map