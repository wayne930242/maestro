import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { PiRunSession, PiProgressEvidence, SummarySource } from "../../maestro/runtime/index.ts";
import type { ResolvedRuntimePlan } from "../../maestro/core/routing.ts";
import type { AcceptOutcome } from "../../maestro/core/accept.ts";
import type { SubagentStatusState } from "../../maestro/core/status.ts";
import type { SubagentActivityState } from "../../maestro/core/types.ts";
import type { LifecycleProjection, SubagentLifecycle } from "../../maestro/core/lifecycle.ts";
import type { NoticeBudget } from "../../maestro/core/specialist-notice.ts";
import type { WorktreeHandoff, WorktreeLaunch } from "../../maestro/core/worktree.ts";
export declare const WIDGET_INTERVAL_KEY: unique symbol;
export declare const STATUS_INTERVAL_KEY: unique symbol;
export declare const RUNTIME_KEY: symbol;
export declare function readGlobalSlot<T>(key: symbol): T | undefined;
export declare function writeGlobalSlot<T>(key: symbol, value: T): void;
export type NoProgressClassification = PiProgressEvidence["classification"];
export type NoProgressSessionTail = Pick<PiProgressEvidence, "classification" | "lastEntryKind">;
export interface ModelFailure {
    model: string;
    error: string;
}
/**
 * Result from running a single subagent.
 */
export interface SubagentResult {
    name: string;
    task: string;
    summary: string;
    summarySource: SummarySource;
    sessionFile?: string;
    exitCode: number;
    elapsed: number;
    error?: string;
    /** Settled provider/agent error text from the child, preserved verbatim. */
    errorMessage?: string;
    /** Ordered models launched for this run, including failed fallback attempts. */
    fallbackAttempts?: string[];
    /** Ordered raw errors associated with failed model attempts. */
    fallbackFailures?: ModelFailure[];
    ping?: {
        name: string;
        message: string;
    };
    worktree?: WorktreeHandoff;
    runtimePlan?: ResolvedRuntimePlan;
    /** The accept verdict; absent means no check was requested. */
    accept?: AcceptOutcome;
}
/**
 * State for a launched (but not yet completed) subagent.
 */
export interface RunningSubagent {
    id: string;
    name: string;
    task: string;
    agent?: string;
    surface: string;
    startTime: number;
    sessionFile: string;
    launchScriptFile?: string;
    activityFile?: string;
    activity?: SubagentActivityState;
    activityRead?: {
        ok: boolean;
        reason?: "missing" | "invalid" | "wrong-id";
        error?: string;
    };
    abortController?: AbortController;
    /**
     * Optional legacy status snapshot retained only for hydrating pre-lifecycle
     * runtime entries after /reload. Live observation uses `lifecycle` only.
     */
    statusState?: SubagentStatusState;
    lifecycle: SubagentLifecycle;
    /** Last projected kind used to detect stalled/recovered transitions. */
    lastProjectedKind?: LifecycleProjection["kind"];
    /** One active no-progress warning episode, reset when durable progress resumes. */
    noProgressEpisode?: {
        active: true;
        progressAt: number;
        idleMs: number;
        classification: NoProgressClassification;
        lastEntryKind: NoProgressSessionTail["lastEntryKind"];
    };
    /**
     * When true, status transitions (stalled/recovered) do not wake the parent
     * session via a steer message. The widget still updates locally. Used for
     * long-running agents where the user drives the conversation in the
     * subagent's pane.
     */
    interactive: boolean;
    /** Parent-resolved model/thinking selection and provenance. */
    runtimePlan: ResolvedRuntimePlan | undefined;
    worktree?: WorktreeLaunch;
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
    /** Events for tasks the parent never issued, ignored after one notice. */
    ignoredTaskEvents?: number;
    /** The parent opted this specialist into notices at launch (ADR-0019). */
    notify?: boolean;
    /** Parent-owned notice accounting; survives reload, not a process crash. */
    noticeBudget?: NoticeBudget;
    inboxSequence?: number;
    observedTaskEvents?: number;
    /** Parent-owned send/ack progress survives reload, not a process crash. */
    persistentTaskDeliveries?: Map<string, "sending" | "sent" | "acknowledged">;
    stopState?: "requested" | "pending" | "failed";
    /** Identity changes before every stop publication, even one that fails. */
    stopAttempt?: {
        cancelNotice?: () => void;
    };
    stopFailure?: string;
    stopTimeout?: ReturnType<typeof setTimeout>;
    stopTimeoutMs?: number;
    crashNotified?: boolean;
    cancelState?: "requested" | "confirmed" | "unconfirmed";
}
/**
 * Work held while no live parent API was bound: a settled completion, whose
 * running row stays delivery-pending and RunSession keeps ownership until it is
 * released, a stop-failure notice awaiting a live send, or a fallback attempt
 * waiting to prepare from the live context.
 */
export interface HeldDelivery {
    /** Running-row id of the held completion or waiting attempt. */
    id: string;
    /** Resume with the replacement's live API, or `undefined` when the parent exits. */
    release(api: ExtensionAPI | undefined): void;
}
export interface SubagentRuntime {
    runningSubagents: Map<string, RunningSubagent>;
    /** Persistent launches acquiring resources but not yet represented by a row. */
    persistentReservations?: Set<string>;
    session?: PiRunSession;
    /** The latest loaded extension API; it can be unbound or already invalidated. */
    pi?: ExtensionAPI;
    latestCtx?: ExtensionContext;
    /**
     * The parent API proven live: bound at session_start and by this load's own
     * tool calls, cleared at session_shutdown before Pi invalidates it. Absent
     * across a reload or session-replacement gap, when nothing may be sent.
     */
    liveApi?: ExtensionAPI;
    /** Completions, stop notices and fallback preparations awaiting a live API. Optional for older slots. */
    heldDeliveries?: HeldDelivery[];
    /**
     * Set by a preserving session_shutdown (reload, new, resume, fork) and cleared
     * when the replacement binds its live API or the parent quits. Only in this gap
     * does a missing context mean "wait" rather than "fail".
     */
    reloadGap?: boolean;
    modelCatalog?: string;
}
/** Bind the live parent API and release every delivery held for it. */
export declare function bindLiveApi(runtime: SubagentRuntime, api: ExtensionAPI): void;
/**
 * The live parent context for preparing a launch. In a reload gap, wait for the
 * replacement session to bind it; `undefined` means none is coming (the parent
 * quit) or, outside a gap, that none exists.
 */
export declare function awaitLiveContext(runtime: SubagentRuntime, id: string, cancelled?: AbortSignal): Promise<ExtensionContext | undefined>;
/**
 * Wait for the next live parent API; `undefined` means the parent exited or
 * `cancelled` aborted, which ends the wait at once and leaves the queue.
 */
export declare function holdDelivery(runtime: SubagentRuntime, id: string, cancelled?: AbortSignal): Promise<ExtensionAPI | undefined>;
/** Release the current held batch once, in order; failed notices may requeue. */
export declare function releaseHeldDeliveries(runtime: SubagentRuntime, api: ExtensionAPI | undefined): void;
/**
 * Any running subagent except a persistent specialist idle between tasks or
 * one whose stop failed, which may never leave the table.
 */
export declare function hasWorkingSubagents(subagents: Iterable<RunningSubagent>): boolean;
export declare function shouldDeliverSubagentCompletion(running: Pick<RunningSubagent, "lifecycle">): boolean;
export declare function selectCompletionApi<T>(previous: T, current: T | undefined): T;
//# sourceMappingURL=state.d.ts.map