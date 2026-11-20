/** The closed verdict set. A sixth value is a contract change. */
export declare const ACCEPT_VERDICTS: readonly ["accepted", "rejected", "error", "skipped", "none"];
export type AcceptVerdict = (typeof ACCEPT_VERDICTS)[number];
export declare const ACCEPT_DEFAULT_MAX_RETRIES = 1;
export declare const ACCEPT_MAX_RETRIES = 5;
export declare const ACCEPT_DEFAULT_TIMEOUT_SEC = 600;
export declare const ACCEPT_MAX_TIMEOUT_SEC = 3600;
/** SIGTERM to the check's process group, then SIGKILL after this grace. */
export declare const ACCEPT_KILL_GRACE_MS = 5000;
/** The shorter SIGKILL grace when the check's owner shuts down. */
export declare const ACCEPT_SHUTDOWN_GRACE_MS = 1000;
/** Combined output kept while a check runs. */
export declare const ACCEPT_CAPTURE_CHARS: number;
/** Failing output the child receives as its retry message. */
export declare const ACCEPT_CHILD_OUTPUT_CHARS = 4000;
/** Raw parent re-check output kept in structured details. */
export declare const ACCEPT_DETAILS_OUTPUT_CHARS = 4000;
/** Parent re-check output shown, encoded, in the delivery. */
export declare const ACCEPT_PARENT_OUTPUT_CHARS = 1500;
/** The child reads its spec from this JSON file; the command never sits in env. */
export declare const ACCEPT_FILE_ENV = "PI_SUBAGENT_ACCEPT_FILE";
/** Custom message type of the child's retry message. */
export declare const ACCEPT_RETRY_MESSAGE_TYPE = "subagent-accept-check";
/** The `accept` tool parameter as the caller sends it. */
export interface AcceptRequest {
    run: string;
    maxRetries?: number;
    timeoutSec?: number;
    paths?: string[];
}
/** A validated check with defaults applied. */
export interface AcceptSpec {
    run: string;
    maxRetries: number;
    timeoutSec: number;
    /** Repo-relative check files; changes the child made to them are reported. */
    paths: string[];
}
/** What the child's own check loop recorded in its `.exit` sidecar. */
export interface ChildAcceptReport {
    tries: number;
    childVerdict: "passed" | "failed";
    lastExitCode?: number;
    timedOut: boolean;
}
/** How one run of the check command ended. */
export type AcceptCommandResult = {
    kind: "exit";
    exitCode: number;
    output: string;
} | {
    kind: "timeout";
    output: string;
} | {
    kind: "signal";
    signal: string;
    output: string;
} | {
    kind: "cwd-missing";
    output: string;
} | {
    kind: "spawn-error";
    error: string;
    output: string;
} | {
    kind: "aborted";
    output: string;
};
/** The verdict a delivery carries, with its structured evidence. */
export interface AcceptOutcome {
    verdict: AcceptVerdict;
    /** Why the verdict is `skipped` or `error`, as closed host text. */
    reason?: string;
    /** Child check runs, from its sidecar; absent when unknown. */
    tries?: number;
    childVerdict?: ChildAcceptReport["childVerdict"];
    /** Exit code of the parent's re-check. */
    exitCode?: number;
    timeoutSec?: number;
    /** `sha256:<hex>` of the command; never the command itself. */
    checkHash?: string;
    /** Where the parent re-check ran. */
    cwd?: string;
    /** The re-check ran in a checkout other writers may share. */
    sharedCheckout?: boolean;
    /** Check files under `paths` that the child changed; the verdict is unchanged. */
    changedCheckFiles?: string[];
    /** Raw tail of the parent re-check output, for `rejected` and `error` only. */
    output?: string;
}
/**
 * Validate an `accept` request and apply its defaults. The tool schema
 * already checked its shape; this re-checks bounds for non-schema callers.
 */
export declare function normalizeAcceptSpec(request: AcceptRequest): AcceptSpec;
/**
 * v1 supports only auto-exit, non-persistent children: an interactive child
 * closes through `subagent_done`, and a persistent specialist settles per task.
 */
export declare function acceptLaunchRefusal(behavior: {
    persistent: boolean;
    autoExit: boolean;
}): string | undefined;
/** Parse the child's sidecar report; anything malformed is treated as unknown. */
export declare function parseChildAcceptReport(raw: any): ChildAcceptReport | undefined;
export declare function acceptCheckHash(run: string): string;
/** Changed files equal to, or under, a check path. */
export declare function changedCheckFiles(paths: readonly string[], files: readonly string[]): string[];
/** Keep the last `count` characters. */
export declare function outputTail(output: string, count: number): string;
/**
 * The parent re-check decides the verdict; the child's report is evidence.
 * `aborted` means an operator cancel stopped the re-check (settled default).
 */
export declare function verdictFromCommand(result: AcceptCommandResult, spec: AcceptSpec, child: ChildAcceptReport | undefined): AcceptOutcome;
/** A requested check whose run did not complete naturally is skipped. */
export declare function skippedOutcome(spec: AcceptSpec, reason: string): AcceptOutcome;
/** The verdict and its detail after `Check: `, for example `accepted (2 tries)`. */
export declare function describeAcceptVerdict(outcome: AcceptOutcome | undefined): string;
/** One outcome-ledger line: never task text, check output, env, or the command. */
export interface OutcomeLedgerLine {
    v: 1;
    at: string;
    runId: string;
    attempt: number;
    role?: string;
    requestedModel?: string;
    category?: string;
    model?: string;
    thinking?: string;
    elapsedSec: number;
    outcome: "completed" | "failed" | "help" | "cancelled";
    checkTries?: number;
    verdict: AcceptVerdict;
    checkHash?: string;
}
export declare const OUTCOME_LEDGER_FILE = "outcomes.jsonl";
export declare function buildOutcomeLedgerLine(input: {
    at: number;
    runId: string;
    attempt: number;
    role?: string;
    requestedModel?: string;
    model?: string;
    thinking?: string;
    elapsedSec: number;
    outcome: OutcomeLedgerLine["outcome"];
    accept?: AcceptOutcome;
}): OutcomeLedgerLine;
//# sourceMappingURL=accept.d.ts.map