import { projectTrackedRuns, type TrackedRunRow } from "./tracked-runs.ts";

/**
 * The process-local slot that holds this process's running-subagent registry.
 * The subagents extension owns and writes it; the child protocol extension
 * only reads it, so both agree on one key without importing each other.
 */
export const SUBAGENT_RUNTIME_KEY = Symbol.for("pi-subagents/runtime");

interface RuntimeSlot {
	runningSubagents?: ReadonlyMap<string, TrackedRunRow>;
}

function readRuntimeSlot(): RuntimeSlot | undefined {
	// SAFETY: `globalThis` has no index signature for this symbol key; the
	// subagents extension is its only writer and stores a `runningSubagents` map.
	const global = globalThis as typeof globalThis & {
		[SUBAGENT_RUNTIME_KEY]?: RuntimeSlot;
	};
	return global[SUBAGENT_RUNTIME_KEY];
}

/**
 * Whether this process launched an ordinary child whose result, help request,
 * or cancellation has not yet been delivered to it.
 *
 * Ordinary completion removes a row just before it sends the result steer, so
 * a row that is still present has not been delivered. A suppressed row will
 * never be delivered and does not count. Persistent specialists stay in the
 * registry by design until they are stopped, so they never count. It reads
 * the same projection the `pi-herdr-agents:runs:v1` probe answers.
 */
export function hasUndeliveredChildren(
	slot: RuntimeSlot | undefined = readRuntimeSlot(),
): boolean {
	return projectTrackedRuns(slot?.runningSubagents).runs.some(
		(run) => !run.persistent && run.delivery === "pending",
	);
}
