import { type LifecycleProjection, type SubagentLifecycle } from "../../maestro/core/lifecycle.ts";
import type { NoProgressClassification, NoProgressSessionTail, RunningSubagent, SubagentRuntime } from "./state.ts";
/**
 * A row as an older version's runtime slot may hold it: it predates the
 * lifecycle model and carries at most a `statusState` snapshot.
 */
export type AdoptedRow = Omit<RunningSubagent, "lifecycle"> & {
    lifecycle?: SubagentLifecycle;
};
/**
 * Give every row of an adopted runtime slot a `lifecycle`, hydrating it from
 * the legacy `statusState`. After this, `RunningSubagent.lifecycle` holds.
 */
export declare function normalizeAdoptedRows(rows: Iterable<AdoptedRow>): void;
/** Whether an adopted row has been normalized to a full running row. */
export declare function isNormalized(row: AdoptedRow): row is RunningSubagent;
type NoProgressAdvisoryEvent = {
    kind: "warning";
    idleMs: number;
    classification: NoProgressClassification;
    lastEntryKind: NoProgressSessionTail["lastEntryKind"];
    notify: boolean;
} | {
    kind: "recovered";
    idleMs: number;
    classification: NoProgressClassification;
    lastEntryKind: NoProgressSessionTail["lastEntryKind"];
    notify: boolean;
};
export type Observation = ReturnType<typeof createObservation>;
/** Activity observation bound to one extension instance's runtime. */
export declare function createObservation(runtime: SubagentRuntime): {
    observeRunningSubagent: (running: RunningSubagent, observedAt?: number) => void;
    evaluateNoProgressAdvisory: (running: RunningSubagent, projection: LifecycleProjection, now: number, hangWarningMinutes: number, inspectProgress?: (running: RunningSubagent) => NoProgressSessionTail) => NoProgressAdvisoryEvent | undefined;
};
export declare function formatNoProgressAdvisoryLine(running: RunningSubagent, event: NoProgressAdvisoryEvent): string;
export {};
//# sourceMappingURL=observation.d.ts.map