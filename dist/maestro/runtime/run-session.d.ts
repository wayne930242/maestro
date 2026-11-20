import type { HarnessAdapter, ResumeOptions, SpawnOptions } from "../core/harness-adapter.ts";
import { type SurfaceProvider } from "../core/surface-provider.ts";
import type { ActivityReadResult, AgentHandle, LifecycleProjection, Role, RunResult, SubagentActivityState, SubagentLifecycle, Task, ThinkingLevel } from "../core/types.ts";
export interface RuntimeCandidate {
    model: string;
    thinking: ThinkingLevel;
}
export type DeliveryDecision = "delivered" | "suppressed";
export interface RunObservation {
    kind: "local-evidence" | "pane" | "tick" | "completion" | "state" | "interrupt" | "refresh";
    observedAt: number;
    lifecycle: SubagentLifecycle;
    projection: LifecycleProjection;
    activity?: SubagentActivityState;
    activityRead?: ActivityReadResult;
}
export interface RunSessionHooks {
    /** Ownership is registered first; a rejected hook leaves it recoverable. */
    onSpawned?(handle: AgentHandle, task: Task): void | Promise<void>;
    onObserved?(handle: AgentHandle, projection: LifecycleProjection, observation: RunObservation): void;
    /**
     * Operator cancel state of the run's current owner: "requested" when intent is
     * recorded or a cancelled owner is transferred, then each owned kill's
     * outcome, including kills the run starts itself. Presentation only.
     */
    onCancelState?(handle: AgentHandle, task: Task, state: "requested" | "confirmed" | "unconfirmed"): void;
    /** Successful void/delivered/suppressed permits cleanup; rejection retains panes. */
    onSettled?(result: RunResult, task: Task): void | DeliveryDecision | Promise<void | DeliveryDecision>;
}
export interface OwnedRunAttempt {
    handle: AgentHandle;
    adapter: HarnessAdapter;
    /** Actual effective policy, when reported by the owner. */
    persistent?: boolean;
    /** Surface-only release, never kill or an absence/process-exit wait. */
    closeTemporarySurface?(): Promise<void>;
    /** Supplied cheap hydration; no getState or extra pane inspection. */
    observe?(at: number): RunObservation;
    /** Evidence/transcript/manifest finalization precedes parent delivery. */
    finalize?(result: RunResult, task: Task, control: FinalizeControl): Promise<RunResult>;
}
/**
 * Host work after the settle point that an operator cancel may still stop,
 * such as the parent's accept re-check (ADR-0017).
 */
export interface FinalizeControl {
    /**
     * Run `work` while `cancel` is still accepted for an already settled natural
     * result. The signal aborts once termination is confirmed or the run is
     * suppressed; a cancel recorded meanwhile delivers the cancelled result.
     * Such a cancel resolves only once its termination is confirmed (or the run
     * is suppressed), so the caller can record it before delivery.
     */
    cancellable<T>(work: (signal: AbortSignal) => Promise<T>): Promise<T>;
    /**
     * How the last `cancellable` window ended, whatever `work` returned:
     * `cancelled` when a cancel recorded in it won with confirmed termination
     * (the run delivers the cancelled result), `suppressed` when the run was
     * suppressed (nothing is delivered), otherwise undefined. The kernel, not
     * the work's output, is authoritative.
     */
    interruption(): "cancelled" | "suppressed" | undefined;
}
export interface PreparedRun {
    /** Captured role and fully validated, stable candidate list. */
    role: Role;
    persistent: boolean;
    candidates: readonly RuntimeCandidate[];
    /**
     * `cancelled` aborts when the run's cancel intent is recorded while the
     * attempt is still being acquired; a long wait inside it must end then and
     * launch nothing.
     */
    spawnAttempt(options: SpawnOptions, candidateIndex: number, cancelled: AbortSignal): Promise<OwnedRunAttempt>;
}
export interface RunSessionOperations {
    prepare(task: Task, role: Role): Promise<PreparedRun>;
    resume?(options: ResumeOptions, task: Task): Promise<OwnedRunAttempt>;
}
export interface RunSessionOptions {
    adapter: HarnessAdapter;
    surfaceProvider?: SurfaceProvider;
    roles: Role[];
    cwd: string;
    sessionIdPrefix?: string;
    /** Accepted for compatibility; never schedules a deadline. */
    defaultTimeoutMs?: number;
    env?: Record<string, string>;
    hooks?: RunSessionHooks;
    operations?: RunSessionOperations;
    retainSurface?: (result: RunResult, task: Task) => boolean;
    /**
     * How often an unconfirmed cancel re-observes whether its target is gone
     * (see `HarnessAdapter.confirmTerminated`). Default: 2000ms.
     */
    terminationRecheckMs?: number;
}
/**
 * Operator cancel report. `requested` means the intent is recorded but an
 * in-flight acquisition still owns the next attempt; that owner is terminated
 * when it is transferred. `unconfirmed` keeps the run live and retryable.
 */
export interface CancelReport {
    status: "requested" | "confirmed" | "unconfirmed" | "already-terminal";
    requestedAt?: number;
    error?: string;
    /** An earlier cancel already recorded this run's intent. */
    repeated?: boolean;
}
export interface RunSession {
    spawn(task: Task, prepared?: PreparedRun): Promise<AgentHandle>;
    /** Joins one owned producer; caller cancellation affects only this wait. */
    supervise(handle: AgentHandle, task: Task, signal?: AbortSignal): Promise<RunResult>;
    /** Live queries only; terminal retirement retains consumed IDs, not history. */
    getHandle(taskId: string): AgentHandle | undefined;
    getTask(taskId: string): Task | undefined;
    resume(options: ResumeOptions & {
        task: Task;
    }): Promise<AgentHandle>;
    send(taskId: string, text: string): Promise<void>;
    kill(taskId: string): Promise<void>;
    interrupt(taskId: string): Promise<void>;
    observe(taskId: string, at?: number): RunObservation | undefined;
    /** Gates delivery before owned abort; a retired ID is an idempotent no-op. */
    suppress(taskId: string): void;
    /**
     * Records terminal operator intent synchronously, then terminates the owned
     * attempt through its adapter. Prevents fallback and delivers one cancelled
     * result once termination is confirmed. Persistent runs are rejected.
     */
    cancel(taskId: string): Promise<CancelReport>;
}
export declare function createRunSession(options: RunSessionOptions): RunSession;
//# sourceMappingURL=run-session.d.ts.map