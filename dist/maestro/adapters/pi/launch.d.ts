import { type SubagentLifecycle } from "../../core/lifecycle.ts";
import { type ResolvedRuntimePlan } from "../../core/routing.ts";
import { type AcceptSpec } from "../../core/accept.ts";
import type { WorktreeLaunch } from "../../core/worktree.ts";
import { type PiProcessIdentity } from "./process-identity.ts";
import { type PiLaunchOperations } from "./launch-operations.ts";
type SubagentSessionMode = "standalone" | "lineage-only" | "fork";
export interface FreshPiLaunchRequest {
    kind: "fresh";
    childEntryPath?: string;
    acquisitionSignal?: AbortSignal;
    id?: string;
    name: string;
    task: string;
    agent?: string;
    cwd?: string;
    worktree?: {
        branch: string;
        base?: string;
    } | null;
    /** Written to a spec file the child reads; a handoff carries none. */
    accept?: AcceptSpec;
    fork?: boolean;
    handoff?: {
        leafId: string;
    };
    surface?: string;
    parent: {
        cwd: string;
        invocationCwd?: string;
        sessionFile: string;
        sessionId: string;
        sessionDir: string;
        agentDir?: string;
    };
    runtimePlan: ResolvedRuntimePlan;
    /** The parent session's model scope (exact provider/model-id refs). The
     * child receives it as its exact allowlist ({@link MODEL_SCOPE_ENV}) and as
     * Pi's `--models` hint; absent leaves it unscoped. */
    modelScope?: readonly string[];
    behavior: {
        tools?: string;
        skills?: string;
        deniedTools: readonly string[];
        /** Lets the child launch another instance of its own role. */
        selfSpawn?: boolean;
        autoExit: boolean;
        interactive: boolean;
        persistent?: boolean;
        /** A persistent specialist may wake the parent with notices (ADR-0019). */
        notify?: boolean;
        logicalId?: string;
        generationId?: string;
        taskId?: string;
        identity?: string;
        systemPromptMode?: "append" | "replace";
        sessionMode: SubagentSessionMode;
        cwd?: string;
        solutionSpace?: string;
    };
}
export interface ResumePiLaunchRequest {
    kind: "resume";
    childEntryPath?: string;
    acquisitionSignal?: AbortSignal;
    id?: string;
    name: string;
    sessionFile: string;
    message?: string;
    parent: {
        sessionId: string;
        sessionDir: string;
    };
    /** The parent session's model scope. When set, the stored model must be in
     * it and is pinned with `--model`; the child receives it as its exact
     * allowlist ({@link MODEL_SCOPE_ENV}) and as Pi's `--models` hint. */
    modelScope?: readonly string[];
    behavior?: {
        autoExit?: boolean;
        interactive?: boolean;
    };
}
export type PiLaunchRequest = FreshPiLaunchRequest | ResumePiLaunchRequest;
export interface PiRunningChild {
    /** Dispatch/rollback failed; this real owner remains controlled until exit. */
    launchFailure?: string;
    id: string;
    name: string;
    task: string;
    agent?: string;
    surface: string;
    /** Only an ordinary pane created by this transaction may be closed. */
    ownsSurface: boolean;
    startTime: number;
    sessionFile: string;
    launchScriptFile: string;
    activityFile: string;
    interactive: boolean;
    runtimePlan: ResolvedRuntimePlan | undefined;
    worktree?: WorktreeLaunch;
    /** Where the child runs: the worktree root or the ordinary cwd. */
    cwd?: string;
    /** The validated accept check the parent re-runs in `cwd`. */
    accept?: AcceptSpec;
    lifecycle: SubagentLifecycle;
    persistent?: boolean;
    logicalId?: string;
    generationId?: string;
    policyHash?: string;
    policyTools?: string[] | null;
    policyDeniedTools?: string[];
    tasksCompleted?: number;
    taskId?: string;
    /** Task IDs this parent dispatched; the child-writable ledger never decides. */
    issuedTaskIds?: string[];
    /** The parent opted this specialist into notices at launch (ADR-0019). */
    notify?: boolean;
    inboxSequence?: number;
    observedTaskEvents?: number;
    stopState?: "requested" | "pending" | "failed";
    stopFailure?: string;
    crashNotified?: boolean;
    /** Managed worktree children: where the child records its own process identity. */
    processIdentityFile?: string;
    /** Verified at launch readiness; a worktree cancel's only signal and exit evidence. */
    processIdentity?: PiProcessIdentity;
    /** Settles when launch-readiness capture verifies or gives up; never rejects. */
    processIdentityCapture?: Promise<PiProcessIdentity | undefined>;
    processIdentityError?: string;
    /** The failure a restarted capture replaced; kept for diagnostics only. */
    processIdentityLastError?: string;
}
/** Ownership transfer, not a retryable rejection. The initialized child is real. */
export declare class AcquiredPiLaunchError extends Error {
    readonly child: PiRunningChild;
    constructor(child: PiRunningChild, cause: unknown);
}
/**
 * Launch one validated Pi-backed request. Lifecycle watching and parent
 * delivery begin only after this transaction returns the running child.
 */
export declare function launchPiSubagent(request: PiLaunchRequest, operations: PiLaunchOperations): Promise<PiRunningChild>;
export declare function launchPiWorktreeHandoff(request: FreshPiLaunchRequest, operations: PiLaunchOperations): Promise<{
    running: PiRunningChild;
    focusError?: string;
}>;
export declare function startProcessIdentityCapture(child: PiRunningChild, operations: PiLaunchOperations, options?: {
    timeoutMs?: number;
}): void;
export {};
//# sourceMappingURL=launch.d.ts.map