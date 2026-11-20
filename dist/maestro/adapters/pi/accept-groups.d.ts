import { type ProcessTreeOptions } from "./process-tree.ts";
/**
 * Who stops a check at shutdown: one per child accept loop and one per parent
 * run session. Identity is by reference; `label` only names it.
 */
export interface AcceptCheckOwner {
    readonly label: string;
}
export interface TrackedAcceptCheck {
    /** The check shell's pid, which leads its process group (POSIX) or tree (Windows). */
    readonly pgid: number;
    /** Who stops it at shutdown; undefined is stopped only at process exit. */
    readonly owner: AcceptCheckOwner | undefined;
    /**
     * How its tree is killed. Carries `alive` so the synchronous sweeps never
     * run `taskkill` against a shell that has exited (its pid may be reused);
     * the other fields are test seams for the Windows branch.
     */
    readonly processTree?: ProcessTreeOptions;
    /** Stop it like an abort: SIGTERM to the group, SIGKILL after `graceMs`. */
    terminate(graceMs: number): void;
    /** Settles once the runner has finished and killed the group. */
    readonly finished: Promise<void>;
}
/** Synchronous, for the `exit` hook: SIGKILL every group still tracked. */
export declare function killTrackedAcceptChecks(): void;
/** Track one running check; the returned function untracks it. */
export declare function trackAcceptCheck(check: TrackedAcceptCheck): () => void;
/**
 * Stop every check `owner` still runs: SIGTERM now, SIGKILL after `graceMs`,
 * and wait for their runners up to a short margin past that. A group still
 * tracked then is killed synchronously before this returns.
 */
export declare function terminateAcceptChecks(owner: AcceptCheckOwner, graceMs?: number): Promise<void>;
//# sourceMappingURL=accept-groups.d.ts.map