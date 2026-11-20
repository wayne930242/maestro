import type { PaneInspection } from "./types.ts";
import { FileWakeRegistry, type WakeReason } from "./wake.ts";
export declare const RECONCILE_INTERVAL_MS = 4800;
export declare const POLLING_INTERVAL_MS = 1000;
export interface PaneListEntry {
    paneId: string;
    workspaceId: string;
}
export interface PaneListSnapshot {
    complete: boolean;
    panes: PaneListEntry[];
}
export interface SupervisionRegistration {
    wait(signal: AbortSignal): Promise<WakeReason>;
    inspectPane(): Promise<PaneInspection>;
    unregister(): void;
}
export interface SupervisionDiagnostics {
    mode: "wake+batch" | "polling(forced)" | "polling(fallback)";
    watcherCount: number;
}
interface SupervisionTimers {
    setTimeout(callback: () => void, milliseconds: number): ReturnType<typeof setTimeout>;
    clearTimeout(timer: ReturnType<typeof setTimeout>): void;
}
/** A runtime-owned coordinator for file wake-ups and shared pane snapshots. */
export declare class SupervisionCoordinator {
    private readonly entries;
    private readonly listPanes;
    private readonly inspectFallback;
    private forcePolling;
    private readonly wakeRegistry;
    private readonly timers;
    private timer;
    private unhealthyTimer;
    private reconciling;
    private unhealthyUntil;
    private nextGeneration;
    private closed;
    constructor(listPanes: () => Promise<PaneListSnapshot>, inspectFallback: (surface: string) => Promise<PaneInspection>, forcePolling?: boolean, wakeRegistry?: FileWakeRegistry, timers?: SupervisionTimers);
    register(sessionFile: string, surface: string): SupervisionRegistration;
    /** Reconfigure the live owner; registration handles and its shared timer survive. */
    setForcePolling(forcePolling: boolean): void;
    private configureEntry;
    diagnostics(): SupervisionDiagnostics;
    close(): void;
    private ensureTimer;
    private unregister;
    private enterFallback;
    private wait;
    private signal;
    private reconcile;
    private inspect;
}
export {};
//# sourceMappingURL=supervision.d.ts.map