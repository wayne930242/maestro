import type { WorktreeOperations } from "../core/worktree.ts";
import type { PiPersistentIO } from "./pi-run-session-types.ts";
/** Persistent inbox, event and ledger I/O, reading the owner's live worktree operations. */
export declare function createPiPersistentIO(state: {
    readonly worktreeOperations: WorktreeOperations;
}): PiPersistentIO;
//# sourceMappingURL=pi-persistent-io.d.ts.map