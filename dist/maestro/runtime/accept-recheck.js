/**
 * The parent's accept re-check and the outcome ledger. The re-check alone
 * produces `accepted`, `rejected` and `error`; the child's report is evidence.
 */
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { buildOutcomeLedgerLine, changedCheckFiles, OUTCOME_LEDGER_FILE, skippedOutcome, verdictFromCommand, } from "../core/accept.js";
/** Why a requested check did not run; undefined when the run completed naturally. */
function skipReason(result, evidence, exitCode) {
    if (result.cancellation)
        return "cancelled";
    if (result.outcome === "killed")
        return "stopped before completion";
    if (evidence?.ping || result.outcome === "help")
        return "help request";
    if (evidence?.errorMessage)
        return "provider error";
    if (!evidence)
        return "run failed";
    if (result.outcome !== "completed" || exitCode !== 0)
        return `exit code ${exitCode}`;
    return undefined;
}
/**
 * Re-run the check only for a completed, uncancelled, exit-0, non-ping
 * result. A cancel that wins during it, or a parent shutdown, makes the
 * verdict `skipped` whatever the check returned: the kernel is authoritative.
 */
export async function runParentAcceptCheck(input) {
    const { spec, worktree } = input;
    const reason = skipReason(input.result, input.evidence, input.exitCode);
    let outcome;
    if (reason)
        outcome = skippedOutcome(spec, reason);
    else {
        const cwd = input.cwd;
        const command = cwd
            ? await input.control.cancellable((signal) => input.runner({
                run: spec.run,
                cwd,
                timeoutMs: spec.timeoutSec * 1000,
                signal,
                owner: input.owner,
            }))
            : { kind: "cwd-missing", output: "" };
        const interruption = cwd ? input.control.interruption() : undefined;
        if (interruption === "cancelled")
            outcome = skippedOutcome(spec, "cancelled");
        else if (interruption === "suppressed")
            outcome = skippedOutcome(spec, "parent shut down");
        else
            outcome = verdictFromCommand(command, spec, input.evidence?.accept);
        if (cwd)
            outcome.cwd = cwd;
        // Other writers and the user may share an ordinary checkout.
        if (outcome.verdict !== "skipped" && !worktree)
            outcome.sharedCheckout = true;
    }
    if (worktree) {
        const changed = changedCheckFiles(spec.paths, [
            ...(worktree.changedFiles ?? []),
            ...(worktree.untrackedFiles ?? []),
        ]);
        if (changed.length)
            outcome.changedCheckFiles = changed;
    }
    return outcome;
}
/** How one model attempt ended, for its outcome-ledger line. */
export function ledgerOutcome(result, evidence, exitCode, cancelledInCheck) {
    if (result.cancellation || cancelledInCheck || result.outcome === "killed")
        return "cancelled";
    if (evidence?.ping)
        return "help";
    return exitCode === 0 ? "completed" : "failed";
}
export function outcomeLedgerFile(configDir) {
    return join(configDir, "herdr-agents", OUTCOME_LEDGER_FILE);
}
/** Best effort: a ledger failure never changes or delays a delivery. */
export function appendOutcomeLedger(file, input) {
    try {
        const line = buildOutcomeLedgerLine(input);
        mkdirSync(dirname(file), { recursive: true });
        appendFileSync(file, `${JSON.stringify(line)}\n`, "utf8");
        return line;
    }
    catch {
        return undefined;
    }
}
//# sourceMappingURL=accept-recheck.js.map