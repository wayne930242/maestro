import type { ActivityReadResult, CompletionResult, CompletionDelivery, LifecycleProjection, PaneInspection, SubagentLifecycle } from "./types.ts";
export type { ActivityDetail, ActivityHealth, CompletionDelivery, LifecycleProjection, PaneInspection, PaneObservation, ProcessState, SubagentLifecycle, SurfaceAgentStatus as HerdrAgentStatus, TurnState, } from "./types.ts";
export declare function createLifecycle(startedAt: number): SubagentLifecycle;
export declare function observePaneInspection(lifecycle: SubagentLifecycle, inspection: PaneInspection, observedAt: number): SubagentLifecycle;
export declare function observeActivity(lifecycle: SubagentLifecycle, read: ActivityReadResult, observedAt: number): SubagentLifecycle;
export declare function markProcessRunning(lifecycle: SubagentLifecycle, confirmedAt: number): SubagentLifecycle;
export declare function markInterruptRequested(lifecycle: SubagentLifecycle, requestedAt: number): SubagentLifecycle;
export declare function markCompletionDetected(lifecycle: SubagentLifecycle, completion: CompletionResult, detectedAt: number): SubagentLifecycle;
export declare function markCompleted(lifecycle: SubagentLifecycle, completedAt: number): SubagentLifecycle;
export declare function markFailed(lifecycle: SubagentLifecycle, error: string, detectedAt: number, exitCode?: number): SubagentLifecycle;
export declare function markDelivery(lifecycle: SubagentLifecycle, delivery: CompletionDelivery): SubagentLifecycle;
export declare function projectLifecycle(lifecycle: SubagentLifecycle, now: number): LifecycleProjection;
export type LifecycleTransition = "stalled" | "recovered" | null;
export declare function lifecycleTransition(previous: LifecycleProjection["kind"] | undefined, next: LifecycleProjection["kind"]): LifecycleTransition;
export declare function formatLifecycleTransitionLine(displayName: string, projection: LifecycleProjection, transition: Exclude<LifecycleTransition, null>, now: number, startedAt: number, formatElapsed: (ms: number) => string): string;
//# sourceMappingURL=lifecycle.d.ts.map