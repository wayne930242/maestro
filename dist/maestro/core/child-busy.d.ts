/**
 * Event-bus channel a child asks before it asks itself whether its task is
 * done. A listener that knows the child is still waiting on work of its own,
 * such as running subagents, sets `busy` synchronously.
 */
export declare const CHILD_BUSY_CHANNEL = "pi-herdr-agents:child-busy";
export interface ChildBusyProbe {
    busy: boolean;
}
export interface ChildBusyEvents {
    emit(channel: string, probe: ChildBusyProbe): void;
}
export declare function isChildBusy(events: ChildBusyEvents | undefined): boolean;
//# sourceMappingURL=child-busy.d.ts.map