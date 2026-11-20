import { buildOutcomeLedgerLine, type AcceptOutcome, type AcceptSpec, type OutcomeLedgerLine } from "../core/accept.ts";
import type { CompletionEvidence, RunResult } from "../core/types.ts";
import type { WorktreeHandoff } from "../core/worktree.ts";
import type { AcceptRunner } from "../adapters/pi/accept-runner.ts";
import type { AcceptCheckOwner } from "../adapters/pi/accept-groups.ts";
import type { FinalizeControl } from "./run-session.ts";
export interface ParentAcceptInput {
    spec: AcceptSpec;
    result: RunResult;
    evidence: CompletionEvidence | undefined;
    exitCode: number;
    /** The child's checkout: the worktree root or its ordinary cwd. */
    cwd: string | undefined;
    /** Captured before the re-check; its file lists reveal changed check files. */
    worktree: WorktreeHandoff | undefined;
    control: FinalizeControl;
    runner: AcceptRunner;
    /** Stops this check at shutdown (`accept-groups.ts`). */
    owner?: AcceptCheckOwner;
}
/**
 * Re-run the check only for a completed, uncancelled, exit-0, non-ping
 * result. A cancel that wins during it, or a parent shutdown, makes the
 * verdict `skipped` whatever the check returned: the kernel is authoritative.
 */
export declare function runParentAcceptCheck(input: ParentAcceptInput): Promise<AcceptOutcome>;
/** How one model attempt ended, for its outcome-ledger line. */
export declare function ledgerOutcome(result: RunResult, evidence: CompletionEvidence | undefined, exitCode: number, cancelledInCheck: boolean): OutcomeLedgerLine["outcome"];
export declare function outcomeLedgerFile(configDir: string): string;
/** Best effort: a ledger failure never changes or delays a delivery. */
export declare function appendOutcomeLedger(file: string, input: Parameters<typeof buildOutcomeLedgerLine>[0]): OutcomeLedgerLine | undefined;
//# sourceMappingURL=accept-recheck.d.ts.map