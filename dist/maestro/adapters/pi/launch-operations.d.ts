import type { PaneConfig } from "../../core/config/pane-config.ts";
import type { SurfaceProvider, AcquisitionControl, NativeExecution } from "../../core/surface-provider.ts";
import type { WorktreeOperations } from "../../core/worktree.ts";
import { type PiProcessIdentity, type ProcessEnvironmentReader, type ProcessIdentityProbe } from "./process-identity.ts";
/** What a captured identity must match: this run, its session, and its pane. */
export interface ProcessIdentityExpectation {
    file: string;
    id: string;
    sessionFile: string;
}
type MaybePromise<T> = T | Promise<T>;
export interface WorktreeSurfaceForLaunch {
    path: string;
    branch: string;
    workspaceId: string;
    paneId: string;
    diagnostics?: string[];
}
export interface PiLaunchOperations {
    /** Present only for atomic native program launches, without a shell pane. */
    nativeExecution?: NativeExecution;
    /** Required for managed worktree launches; ordinary panes need no Git effects. */
    worktree?: WorktreeOperations;
    createPane(name: string, cwd?: string, control?: AcquisitionControl): MaybePromise<string>;
    createWorktree(name: string, cwd: string, branch: string, base: string, control?: AcquisitionControl): MaybePromise<WorktreeSurfaceForLaunch>;
    waitForShellReady(surface: string): Promise<void>;
    /**
     * Rejects with a command-dispatch `AcquisitionUncertainError` only when Pi
     * may have started; any other rejection means nothing was dispatched, so the
     * launch rolls back as a definite failure.
     */
    runScript(surface: string, command: string, options: {
        scriptPath: string;
        scriptPreamble: string;
    }): MaybePromise<string>;
    /** Rollback resolves only once this ordinary pane is confirmed absent. */
    closePane(pane: string): MaybePromise<void>;
    waitForPiReady?(surface: string, sessionFile: string, cwd: string): Promise<void>;
    focusWorkspace?(workspaceId: string): MaybePromise<void>;
    /** Bounded readiness capture of a worktree child's verified process identity. */
    captureProcessIdentity?(surface: string, expected: ProcessIdentityExpectation, options?: {
        timeoutMs?: number;
    }): Promise<PiProcessIdentity>;
}
/**
 * Names the launched session in the Pi process's exec-time environment. Pi
 * rewrites its command line, so `--session` is never readiness evidence.
 * Nothing inside Pi reads it.
 */
export declare const PI_LAUNCH_SESSION_ENV = "PI_HERDR_AGENTS_SESSION";
export declare function isExpectedPiProcess(process: {
    pid: number;
    name?: string;
    argv0?: string;
    argv?: string[];
    cwd?: string;
}, sessionFile: string, cwd: string, readEnvironment?: ProcessEnvironmentReader, platform?: NodeJS.Platform): boolean;
/**
 * Wait for the child to publish its own identity, then accept it only while
 * that process is alive in this host's namespace as the Herdr pane shell or a
 * descendant of it. Command-line text is never consulted: Pi rewrites it.
 */
export declare function captureSurfacePiProcessIdentity(provider: Pick<SurfaceProvider, "getProcessInfo">, surface: string, expected: ProcessIdentityExpectation, options?: {
    timeoutMs?: number;
    intervalMs?: number;
    probe?: ProcessIdentityProbe;
}): Promise<PiProcessIdentity>;
/**
 * The pending value if it settles before the deadline; otherwise undefined.
 * A value that arrives after the deadline is dropped, never reported, even
 * when a delayed event loop runs it before the overdue timer.
 */
export declare function settleBefore<T>(pending: Promise<T> | undefined, deadline: number, options?: {
    unref?: boolean;
}): Promise<T | undefined>;
export declare function launchOperationsFromSurface(provider: SurfaceProvider, config: PaneConfig, worktree?: WorktreeOperations): PiLaunchOperations;
export {};
//# sourceMappingURL=launch-operations.d.ts.map