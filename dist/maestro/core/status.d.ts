export declare const SNAPSHOT_STALLED_AFTER_MS = 60000;
export declare const DEFAULT_STATUS_LINE_LIMIT = 4;
export declare const MAX_STATUS_NAME_LENGTH = 72;
export declare const MAX_STATUS_LINE_LENGTH = 120;
export type SubagentStatusKind = "starting" | "active" | "waiting" | "stalled";
export type SubagentStatusTransition = "stalled" | "recovered" | null;
export type StatusSnapshotState = "unseen" | "present" | "missing" | "invalid" | "wrong-id";
export type StatusActivityPhase = "starting" | "active" | "waiting" | "done";
export interface StatusConfig {
    enabled: boolean;
    lineLimit: number;
}
export type StatusObservation = {
    snapshot: "present";
    updatedAt: number;
    sequence: number;
    phase: StatusActivityPhase;
    active?: boolean;
    activeScope?: string;
    activeSince?: number;
    waitingSince?: number;
    latestEvent?: string;
    activityLabel?: string;
} | {
    snapshot: "missing" | "invalid" | "wrong-id";
    snapshotError?: string;
};
export interface SubagentStatusState {
    startTimeMs: number;
    firstObservationAtMs: number | null;
    lastActivityAtMs: number | null;
    lastActivitySequence: number | null;
    localOverrideAtMs: number | null;
    localOverrideSequence: number | null;
    activeNow: boolean;
    activeSinceMs: number | null;
    activeScope: string | null;
    waitingSinceMs: number | null;
    phase: StatusActivityPhase | null;
    latestEvent: string | null;
    activityLabel: string | null;
    snapshotState: StatusSnapshotState;
    snapshotProblemSinceMs: number | null;
    snapshotError: string | null;
    currentKind: SubagentStatusKind;
}
export interface StatusSnapshot {
    kind: SubagentStatusKind;
    elapsedMs: number;
    elapsedText: string;
    activeSinceMs: number | null;
    activeDurationText: string | null;
    activeScope: string | null;
    waitingSinceMs: number | null;
    waitingDurationText: string | null;
    latestEvent: string | null;
    activityLabel: string | null;
    snapshotState: StatusSnapshotState;
    snapshotError: string | null;
    snapshotProblemText: string | null;
    statusLabel: string | null;
}
export interface CappedStatusLines {
    visibleLines: string[];
    overflow: number;
}
export declare function normalizeStatusName(name: string): string;
export declare function parseStatusConfig(rawConfig: any, source?: string): StatusConfig;
export declare function loadStatusConfig(configPath: string, examplePath: string): StatusConfig;
export declare function formatElapsedDuration(ms: number): string;
export declare function createStatusState(params: {
    startTimeMs: number;
}): SubagentStatusState;
export declare function observeStatus(state: SubagentStatusState, observation: StatusObservation, now: number): SubagentStatusState;
export declare function forceStatusAfterInterrupt(state: SubagentStatusState, now: number): SubagentStatusState;
export declare function classifyStatus(state: SubagentStatusState, now: number): StatusSnapshot;
export interface StatusAdvance {
    nextState: SubagentStatusState;
    snapshot: StatusSnapshot;
    transition: SubagentStatusTransition;
}
export declare function advanceStatusState(state: SubagentStatusState, now: number): StatusAdvance;
export declare function formatStatusLine(name: string, snapshot: StatusSnapshot): string;
export declare function formatTransitionLine(name: string, snapshot: StatusSnapshot, transition: Exclude<SubagentStatusTransition, null>): string;
export declare function capStatusLines(lines: string[], lineLimit: number): CappedStatusLines;
export declare function formatStatusAggregate(lines: string[], lineLimit: number): string;
//# sourceMappingURL=status.d.ts.map