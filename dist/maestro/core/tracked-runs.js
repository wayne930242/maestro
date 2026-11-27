/**
 * Event-bus channel another in-process extension emits to read the runs this
 * process's run owner tracks now. The owner sets `snapshot` on the probe
 * synchronously; a probe left without one means no owner answered.
 */
export const TRACKED_RUNS_CHANNEL = "pi-herdr-agents:runs:v1";
/**
 * The runs a registry holds now, keyed by run id, in registry order. Ordinary
 * completion removes a row just before it sends the result, so the snapshot
 * holds no delivered history. Each run is a fresh copy of the row's fields.
 * A row without a name or lifecycle (an older slot's row) reads its id as the
 * name and a pending delivery.
 */
export function projectTrackedRuns(rows) {
    const runs = [];
    for (const [id, row] of rows ?? []) {
        const run = {
            id,
            name: row.name ?? id,
            persistent: row.persistent === true,
            delivery: row.lifecycle?.delivery ?? "pending",
        };
        if (row.agent !== undefined)
            run.agent = row.agent;
        runs.push(run);
    }
    return { version: 1, runs };
}
/** Ask the bus; `undefined` means no run owner answered. */
export function readTrackedRuns(events) {
    if (!events)
        return undefined;
    const probe = {};
    events.emit(TRACKED_RUNS_CHANNEL, probe);
    return probe.snapshot;
}
//# sourceMappingURL=tracked-runs.js.map