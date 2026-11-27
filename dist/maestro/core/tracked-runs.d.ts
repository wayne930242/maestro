import type { CompletionDelivery } from "./types.ts";
/**
 * Event-bus channel another in-process extension emits to read the runs this
 * process's run owner tracks now. The owner sets `snapshot` on the probe
 * synchronously; a probe left without one means no owner answered.
 */
export declare const TRACKED_RUNS_CHANNEL = "pi-herdr-agents:runs:v1";
/** One run the owner tracks now. */
export interface TrackedRun {
    /** The run id: the child's `PI_SUBAGENT_ID` and the launch's `details.id`. */
    id: string;
    /** The name the parent gave the run. */
    name: string;
    /** The resolved role, when the run has one. */
    agent?: string;
    /** A persistent specialist, tracked until it is stopped. */
    persistent: boolean;
    /** Whether the run's outcome is still to be delivered to this parent. */
    delivery: CompletionDelivery;
}
export interface TrackedRunsSnapshot {
    version: 1;
    runs: TrackedRun[];
}
/** The object an emitter passes on `TRACKED_RUNS_CHANNEL`. */
export interface TrackedRunsProbe {
    snapshot?: TrackedRunsSnapshot;
}
/** The fields of a running-subagent registry row the projection reads. */
export interface TrackedRunRow {
    name?: string;
    agent?: string;
    persistent?: boolean;
    lifecycle?: {
        delivery?: CompletionDelivery;
    };
}
/**
 * The runs a registry holds now, keyed by run id, in registry order. Ordinary
 * completion removes a row just before it sends the result, so the snapshot
 * holds no delivered history. Each run is a fresh copy of the row's fields.
 * A row without a name or lifecycle (an older slot's row) reads its id as the
 * name and a pending delivery.
 */
export declare function projectTrackedRuns(rows: ReadonlyMap<string, TrackedRunRow> | undefined): TrackedRunsSnapshot;
export interface TrackedRunsEvents {
    emit(channel: string, probe: TrackedRunsProbe): void;
}
/** Ask the bus; `undefined` means no run owner answered. */
export declare function readTrackedRuns(events: TrackedRunsEvents | undefined): TrackedRunsSnapshot | undefined;
//# sourceMappingURL=tracked-runs.d.ts.map