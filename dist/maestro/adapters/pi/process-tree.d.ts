/** Runs one command and reports whether it exited 0. */
export type CommandRunner = (command: string, args: string[]) => boolean;
export type AsyncCommandRunner = (command: string, args: string[]) => Promise<boolean>;
/**
 * Seams for the Windows branch, so Linux tests can drive it. Production code
 * passes nothing except `alive`.
 */
export interface ProcessTreeOptions {
    platform?: NodeJS.Platform;
    /** Where `SystemRoot` is read from; defaults to `process.env`. */
    env?: NodeJS.ProcessEnv;
    /** Blocking `taskkill`, for the `exit` hook and the final sweep. */
    run?: CommandRunner;
    /** Non-blocking `taskkill`, for everything on Pi's main thread. */
    runAsync?: AsyncCommandRunner;
    /**
     * Whether the shell that leads the tree is still running. Once it has
     * exited its pid is free to be reused by an unrelated process, and
     * `taskkill /T` cannot find a dead root's descendants anyway, so on Windows
     * a false answer means no tree kill is attempted. POSIX ignores it: a process
     * group outlives its leader and `kill(-pid)` only reaches that group.
     */
    alive?: () => boolean;
}
/**
 * Signal a process and everything it started. POSIX children are spawned
 * `detached`, so each leads its own process group and `kill(-pid)` reaches the
 * whole tree. Windows has no process groups or signals: `taskkill /T /F`
 * force-ends the process and its descendants instead, so every signal (even
 * SIGTERM) is final there and a grace period before SIGKILL buys nothing.
 *
 * This form blocks (up to the `taskkill` timeout on Windows), so it is for the
 * `exit` hook and the final shutdown sweep. Everything else uses
 * `signalProcessTree`.
 *
 * Returns whether the signal was delivered. False is not an error: the
 * process may already be gone, and Windows cannot find the descendants of a
 * parent that has already exited.
 */
export declare function killProcessTree(pid: number, signal: NodeJS.Signals, options?: ProcessTreeOptions): boolean;
/**
 * Like `killProcessTree`, but never blocks: on Windows `taskkill` runs
 * asynchronously. `onMiss` runs when nothing was signalled (the group is gone,
 * `taskkill` found nothing or failed, or the shell had already exited), so the
 * caller can fall back to signalling the shell alone.
 */
export declare function signalProcessTree(pid: number, signal: NodeJS.Signals, onMiss: () => void, options?: ProcessTreeOptions): void;
//# sourceMappingURL=process-tree.d.ts.map