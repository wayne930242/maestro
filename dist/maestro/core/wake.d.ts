import { watch } from "node:fs";
export type WakeReason = "wake" | "reconcile";
export interface WakeRegistration {
    watching: boolean;
    unregister(): void;
}
/**
 * Shares directory watches between supervised sessions. Sidecars use atomic
 * rename and task events use appendFileSync, so directories are watched deliberately.
 */
export declare class FileWakeRegistry {
    private readonly directories;
    private readonly watchDirectory;
    private closed;
    private retained;
    constructor(watchDirectory?: typeof watch);
    register(sessionFile: string, wake: () => void, fallback: () => void): WakeRegistration;
    get watcherCount(): number;
    /** Outstanding retains; every directory watch is referenced while nonzero. */
    get retainedWaits(): number;
    /**
     * Pin every active directory watch until the returned function runs.
     * A bare wake promise does not keep the event loop alive, and idle watches
     * are unref'd, so without this the callback never runs when that promise is
     * the only pending work.
     */
    retain(): () => void;
    close(): void;
    private applyWatcherRef;
    private failDirectory;
}
//# sourceMappingURL=wake.d.ts.map