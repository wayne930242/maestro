import { encodeHostValue, HOST_PATH_CHARS, } from "../../maestro/core/host-text.js";
import { statSync } from "node:fs";
import { observePiActivity } from "../../maestro/runtime/index.js";
import { formatElapsedDuration, normalizeStatusName, } from "../../maestro/core/status.js";
import { isSubagentActivityScope } from "../../maestro/core/activity.js";
import { createLifecycle, markInterruptRequested, markProcessRunning, observeActivity, observePaneInspection, } from "../../maestro/core/lifecycle.js";
/**
 * Give every row of an adopted runtime slot a `lifecycle`, hydrating it from
 * the legacy `statusState`. After this, `RunningSubagent.lifecycle` holds.
 */
export function normalizeAdoptedRows(rows) {
    for (const row of rows)
        hydrateLifecycle(row);
}
/** Whether an adopted row has been normalized to a full running row. */
export function isNormalized(row) {
    return row.lifecycle !== undefined;
}
function hydrateLifecycle(running) {
    if (running.lifecycle)
        return running.lifecycle;
    let lifecycle = createLifecycle(running.startTime);
    const state = running.statusState;
    if (state?.activityLabel === "interrupted" &&
        state.localOverrideAtMs != null) {
        lifecycle = markInterruptRequested(lifecycle, state.localOverrideAtMs);
    }
    else if (state?.phase === "done") {
        // Legacy activity "done" means the turn ended, not that completion
        // evidence was recorded. Hydrate as Herdr-style waiting and let the
        // preserved watcher consume sidecar/sentinel evidence.
        const observedAt = state.lastActivityAtMs ?? running.startTime;
        lifecycle = observePaneInspection(lifecycle, { kind: "present", observedAt, agentStatus: "done" }, observedAt);
    }
    else if (state?.phase === "active" ||
        state?.phase === "waiting" ||
        state?.phase === "starting") {
        const activity = {
            version: 1,
            runningChildId: running.id,
            createdAt: running.startTime,
            updatedAt: state.lastActivityAtMs ?? running.startTime,
            sequence: state.lastActivitySequence ?? 0,
            latestEvent: state.latestEvent === "agent_end" ? "agent_end" : "agent_start",
            phase: state.phase,
            agentActive: state.phase === "active",
            turnActive: state.phase === "active",
            providerActive: false,
            toolActive: state.activeScope === "tool",
        };
        if (isSubagentActivityScope(state.activeScope)) {
            activity.activeScope = state.activeScope;
        }
        if (state.activeSinceMs != null)
            activity.activeSince = state.activeSinceMs;
        if (state.waitingSinceMs != null)
            activity.waitingSince = state.waitingSinceMs;
        if (state.activityLabel && state.activeScope === "tool") {
            activity.toolName = state.activityLabel;
        }
        lifecycle = observeActivity(lifecycle, { ok: true, activity }, state.lastActivityAtMs ?? running.startTime);
    }
    else if (running.startTime) {
        // Pre-lifecycle Pi agents without a known phase still get a running process.
        lifecycle = markProcessRunning(lifecycle, running.startTime);
    }
    running.lifecycle = lifecycle;
    return lifecycle;
}
/** Activity observation bound to one extension instance's runtime. */
export function createObservation(runtime) {
    function observeRunningSubagent(running, observedAt = Date.now()) {
        const control = runtime.session?.getControlTaskId(running.id);
        if (control) {
            runtime.session.observe(control, observedAt);
            return;
        }
        const observation = observePiActivity({
            id: running.id,
            activityFile: running.activityFile,
            lifecycle: running.lifecycle,
        }, observedAt);
        const read = observation.activityRead;
        running.activityRead = read.ok
            ? { ok: true }
            : { ok: false, reason: read.reason, error: read.error };
        if (read.ok)
            running.activity = read.activity;
        running.lifecycle = observation.lifecycle;
    }
    function evaluateNoProgressAdvisory(running, projection, now, hangWarningMinutes, inspectProgress = (running) => {
        const control = runtime.session?.getControlTaskId(running.id);
        return control
            ? runtime.session.inspectProgress(control)
            : { classification: "generic-no-progress", lastEntryKind: "other" };
    }) {
        if (hangWarningMinutes === 0) {
            delete running.noProgressEpisode;
            return;
        }
        if (projection.kind !== "active" && projection.kind !== "blocked") {
            delete running.noProgressEpisode;
            return;
        }
        let sessionMtime;
        try {
            sessionMtime = statSync(running.sessionFile).mtimeMs;
        }
        catch {
            // Session evidence is unavailable; do not turn that I/O problem into a hang.
            return;
        }
        const progressAt = Math.min(now, Math.max(sessionMtime, running.activity?.updatedAt ?? Number.NEGATIVE_INFINITY));
        const idleMs = Math.max(0, now - progressAt);
        if (idleMs <= hangWarningMinutes * 60_000) {
            const previous = running.noProgressEpisode;
            delete running.noProgressEpisode;
            return previous
                ? {
                    kind: "recovered",
                    idleMs: Math.max(0, now - previous.progressAt),
                    classification: previous.classification,
                    lastEntryKind: previous.lastEntryKind,
                    notify: !running.interactive,
                }
                : undefined;
        }
        if (running.noProgressEpisode)
            return;
        let tail = {
            classification: "generic-no-progress",
            lastEntryKind: "other",
        };
        try {
            // The bounded reader is deliberately cold-path only: mtime/snapshot checks
            // above run on every refresh, but JSONL parsing happens once per episode.
            tail = inspectProgress(running);
        }
        catch {
            // A session can disappear between stat and read; preserve a facts-only
            // generic advisory rather than failing the status loop.
        }
        running.noProgressEpisode = { active: true, progressAt, idleMs, ...tail };
        return { kind: "warning", idleMs, ...tail, notify: !running.interactive };
    }
    return { observeRunningSubagent, evaluateNoProgressAdvisory };
}
export function formatNoProgressAdvisoryLine(running, event) {
    const name = encodeHostValue(normalizeStatusName(running.name));
    const persistentIds = running.persistent
        ? ` Logical ID: ${encodeHostValue(running.logicalId ?? "unknown")}; generation ID: ${encodeHostValue(running.generationId ?? "unknown")}.`
        : "";
    if (event.kind === "recovered") {
        return `${name} no-progress advisory recovered after ${formatElapsedDuration(event.idleMs)}.${persistentIds}`;
    }
    const classification = event.classification === "blocked-tool"
        ? "blocked-tool; the outstanding tool may still complete"
        : event.classification === "truncated-turn"
            ? "truncated-turn; observed toolUse stop with no tool call; cause unknown"
            : "generic no-progress";
    const options = running.worktree
        ? "interrupt, or retain the workspace and continue there after confirming the previous process exited"
        : running.persistent
            ? "interrupt, or use subagent_stop then replace with a new persistent specialist"
            : "interrupt, or after manual termination use subagent_resume or a new spawn";
    return `${name} no-progress advisory: ${formatElapsedDuration(event.idleMs)} idle while active. Classification: ${classification}. Last entry: ${encodeHostValue(event.lastEntryKind)}. Session: ${encodeHostValue(running.sessionFile, HOST_PATH_CHARS)}. Recovery options: ${options}.${persistentIds}`;
}
//# sourceMappingURL=observation.js.map