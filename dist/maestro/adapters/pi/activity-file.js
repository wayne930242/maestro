import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync, } from "node:fs";
import { dirname, join } from "node:path";
import { isBoolean, isFiniteNumber, isPlainObject, isString, } from "../../core/config/type-guards.js";
import { isSubagentActivityScope, projectActivity, } from "../../core/activity.js";
const ACTIVITY_UPDATE_THROTTLE_MS = 500;
const MAX_WRITE_FAILURES = 3;
const KNOWN_PHASES = new Set([
    "starting",
    "active",
    "waiting",
    "done",
]);
const KNOWN_EVENTS = new Set([
    "session_start",
    "input",
    "before_agent_start",
    "agent_start",
    "agent_end",
    "turn_start",
    "turn_end",
    "before_provider_request",
    "after_provider_response",
    "message_update",
    "tool_execution_start",
    "tool_call",
    "tool_execution_update",
    "tool_result",
    "tool_execution_end",
    "caller_ping",
    "subagent_done",
    "session_shutdown",
]);
const TERMINAL_EVENTS = new Set([
    "caller_ping",
    "subagent_done",
    "session_shutdown",
]);
const MAX_ACTIVITY_STRING_LENGTH = 200;
export function getSubagentActivityFile(artifactDir, runningChildId) {
    return join(artifactDir, "subagent-activity", `${runningChildId}.json`);
}
function requireObject(value) {
    return isPlainObject(value) ? value : null;
}
function validateFiniteNumber(object, fieldName) {
    return isFiniteNumber(object[fieldName])
        ? null
        : `${fieldName} must be finite`;
}
function validateOptionalFiniteNumber(object, fieldName) {
    const value = object[fieldName];
    return value == null || isFiniteNumber(value)
        ? null
        : `${fieldName} must be finite when present`;
}
function validateInteger(object, fieldName) {
    return Number.isInteger(object[fieldName])
        ? null
        : `${fieldName} must be an integer`;
}
function validateOptionalInteger(object, fieldName) {
    const value = object[fieldName];
    return value == null || Number.isInteger(value)
        ? null
        : `${fieldName} must be an integer when present`;
}
function validateBoolean(object, fieldName) {
    return isBoolean(object[fieldName]) ? null : `${fieldName} must be a boolean`;
}
function validateOptionalActivityString(object, fieldName) {
    const value = object[fieldName];
    if (value == null)
        return null;
    if (!isString(value))
        return `${fieldName} must be a string when present`;
    if (/\r|\n/.test(value))
        return `${fieldName} must not contain newlines`;
    return value.length <= MAX_ACTIVITY_STRING_LENGTH
        ? null
        : `${fieldName} is too long`;
}
function invalidActivity(error) {
    return { ok: false, reason: "invalid", error };
}
function validateActivity(value, expectedRunningChildId) {
    const object = requireObject(value);
    if (!object)
        return invalidActivity("activity must be an object");
    if (object.version !== 1)
        return invalidActivity("unsupported activity version");
    if (!isString(object.runningChildId))
        return invalidActivity("runningChildId must be a string");
    if (object.runningChildId !== expectedRunningChildId)
        return { ok: false, reason: "wrong-id" };
    if (!isString(object.latestEvent) || !KNOWN_EVENTS.has(object.latestEvent)) {
        return invalidActivity("unknown latestEvent");
    }
    if (!isString(object.phase) || !KNOWN_PHASES.has(object.phase)) {
        return invalidActivity("unknown activity phase");
    }
    if (object.activeScope != null &&
        !isSubagentActivityScope(object.activeScope)) {
        return invalidActivity("unknown activeScope");
    }
    const validationError = [
        validateFiniteNumber(object, "createdAt"),
        validateFiniteNumber(object, "updatedAt"),
        validateInteger(object, "sequence"),
        validateBoolean(object, "agentActive"),
        validateBoolean(object, "turnActive"),
        validateBoolean(object, "providerActive"),
        validateBoolean(object, "toolActive"),
        validateOptionalFiniteNumber(object, "activeSince"),
        validateOptionalFiniteNumber(object, "waitingSince"),
        validateOptionalInteger(object, "turnIndex"),
        validateOptionalFiniteNumber(object, "toolStartedAt"),
        validateOptionalFiniteNumber(object, "toolEndedAt"),
        validateOptionalActivityString(object, "messageEventType"),
        validateOptionalActivityString(object, "toolCallId"),
        validateOptionalActivityString(object, "toolName"),
    ].find((error) => error != null);
    if (validationError)
        return invalidActivity(validationError);
    return projectActivity(object);
}
export function readSubagentActivityFile(activityFile, expectedRunningChildId) {
    if (!existsSync(activityFile))
        return projectActivity(undefined);
    let parsed;
    try {
        parsed = JSON.parse(readFileSync(activityFile, "utf8"));
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { ok: false, reason: "invalid", error: message };
    }
    return validateActivity(parsed, expectedRunningChildId);
}
export function writeSubagentActivityFile(activityFile, activity) {
    const dir = dirname(activityFile);
    mkdirSync(dir, { recursive: true });
    const tempFile = join(dir, `${activity.runningChildId}.json.${process.pid}.${activity.sequence}.tmp`);
    try {
        writeFileSync(tempFile, `${JSON.stringify(activity)}\n`, "utf8");
        renameSync(tempFile, activityFile);
    }
    catch (error) {
        try {
            unlinkSync(tempFile);
        }
        catch (cleanupError) {
            // Temp cleanup is best effort; preserve the original write/rename failure
            void cleanupError;
        }
        throw error;
    }
}
function createNoopRecorder() {
    return {
        sessionStart() { },
        input() { },
        beforeAgentStart() { },
        agentStart() { },
        agentEndWaiting() { },
        agentEndDone() { },
        turnStart() { },
        turnEnd() { },
        beforeProviderRequest() { },
        afterProviderResponse() { },
        messageUpdate() { },
        toolExecutionStart() { },
        toolCall() { },
        toolExecutionUpdate() { },
        toolResult() { },
        toolExecutionEnd() { },
        callerPing() { },
        subagentDone() { },
        taskStart() { },
        sessionShutdown() { },
    };
}
function clearActiveState(activity) {
    activity.agentActive = false;
    activity.turnActive = false;
    activity.providerActive = false;
    activity.toolActive = false;
    delete activity.activeScope;
    delete activity.activeSince;
}
function refreshActiveScope(activity) {
    if (activity.toolActive) {
        activity.phase = "active";
        activity.activeScope = "tool";
        return;
    }
    if (activity.providerActive) {
        activity.phase = "active";
        activity.activeScope = "provider";
        return;
    }
    if (activity.turnActive) {
        activity.phase = "active";
        activity.activeScope = "turn";
        return;
    }
    if (activity.agentActive) {
        activity.phase = "active";
        activity.activeScope = "agent";
        return;
    }
    delete activity.activeScope;
    delete activity.activeSince;
}
function markActive(activity, scope, now, resetActiveSince = false) {
    activity.phase = "active";
    activity.activeScope = scope;
    if (activity.activeSince == null || resetActiveSince)
        activity.activeSince = now;
    delete activity.waitingSince;
}
export function createSubagentActivityRecorder(params) {
    const runningChildId = params.runningChildId?.trim();
    const activityFile = params.activityFile?.trim();
    if (!runningChildId || !activityFile)
        return createNoopRecorder();
    return createFileActivityRecorder(runningChildId, activityFile, params.now ?? (() => Date.now()), params.persistent === true);
}
function createFileActivityRecorder(runningChildId, activityFile, now, persistent) {
    const createdAt = now();
    const activity = {
        version: 1,
        runningChildId,
        createdAt,
        updatedAt: createdAt,
        sequence: 0,
        latestEvent: "session_start",
        phase: "starting",
        agentActive: false,
        turnActive: false,
        providerActive: false,
        toolActive: false,
    };
    let disabled = false;
    // A persistent specialist's finished task: only a terminal event or the next
    // task changes the file until then.
    let taskDone = false;
    let failureCount = 0;
    let lastFlushAt = 0;
    let pendingFlush = null;
    function clearPendingFlush() {
        if (!pendingFlush)
            return;
        clearTimeout(pendingFlush);
        pendingFlush = null;
    }
    function disable() {
        disabled = true;
        clearPendingFlush();
    }
    function flushNow() {
        if (disabled)
            return;
        try {
            writeSubagentActivityFile(activityFile, activity);
            lastFlushAt = now();
            failureCount = 0;
        }
        catch {
            failureCount += 1;
            if (failureCount >= MAX_WRITE_FAILURES)
                disable();
        }
    }
    function scheduleFlush() {
        if (disabled || pendingFlush)
            return;
        const remainingMs = Math.max(0, ACTIVITY_UPDATE_THROTTLE_MS - (now() - lastFlushAt));
        if (remainingMs === 0) {
            flushNow();
            return;
        }
        pendingFlush = setTimeout(() => {
            pendingFlush = null;
            flushNow();
        }, remainingMs);
    }
    function record(latestEvent, update, flush) {
        if (disabled)
            return;
        if (taskDone && !TERMINAL_EVENTS.has(latestEvent))
            return;
        if (flush === "immediate")
            clearPendingFlush();
        const observedAt = now();
        activity.latestEvent = latestEvent;
        activity.updatedAt = observedAt;
        activity.sequence += 1;
        update(activity, observedAt);
        if (flush === "immediate")
            flushNow();
        else
            scheduleFlush();
    }
    function markDone(latestEvent) {
        record(latestEvent, (current) => {
            current.phase = "done";
            clearActiveState(current);
            delete current.waitingSince;
        }, "immediate");
        if (persistent && latestEvent !== "session_shutdown")
            taskDone = true;
        else
            disable();
    }
    return {
        sessionStart() {
            record("session_start", (current) => {
                current.phase = "starting";
                clearActiveState(current);
                delete current.waitingSince;
            }, "immediate");
        },
        input() {
            record("input", () => { }, "immediate");
        },
        beforeAgentStart() {
            record("before_agent_start", (current, observedAt) => {
                current.agentActive = true;
                markActive(current, "agent", observedAt);
            }, "immediate");
        },
        agentStart() {
            record("agent_start", (current, observedAt) => {
                current.agentActive = true;
                markActive(current, "agent", observedAt);
            }, "immediate");
        },
        agentEndWaiting() {
            record("agent_end", (current, observedAt) => {
                clearActiveState(current);
                current.phase = "waiting";
                current.waitingSince = observedAt;
            }, "immediate");
        },
        agentEndDone() {
            markDone("agent_end");
        },
        turnStart(turnIndex) {
            record("turn_start", (current, observedAt) => {
                current.agentActive = true;
                current.turnActive = true;
                if (turnIndex != null)
                    current.turnIndex = turnIndex;
                markActive(current, current.toolActive || current.providerActive
                    ? (current.activeScope ?? "turn")
                    : "turn", observedAt);
            }, "immediate");
        },
        turnEnd(turnIndex) {
            record("turn_end", (current) => {
                current.turnActive = false;
                current.providerActive = false;
                current.toolActive = false;
                if (turnIndex != null)
                    current.turnIndex = turnIndex;
                refreshActiveScope(current);
            }, "immediate");
        },
        beforeProviderRequest() {
            record("before_provider_request", (current, observedAt) => {
                current.providerActive = true;
                markActive(current, "provider", observedAt, true);
            }, "immediate");
        },
        afterProviderResponse() {
            record("after_provider_response", (current) => {
                current.providerActive = false;
                refreshActiveScope(current);
            }, "immediate");
        },
        messageUpdate(messageEventType) {
            record("message_update", (current, observedAt) => {
                current.agentActive = true;
                current.turnActive = true;
                current.messageEventType = messageEventType;
                if (!current.toolActive)
                    markActive(current, "streaming", observedAt);
            }, "throttled");
        },
        toolExecutionStart(toolCallId, toolName) {
            record("tool_execution_start", (current, observedAt) => {
                current.toolActive = true;
                current.toolCallId = toolCallId;
                current.toolName = toolName;
                current.toolStartedAt = observedAt;
                markActive(current, "tool", observedAt, true);
            }, "immediate");
        },
        toolCall(toolCallId, toolName) {
            record("tool_call", (current, observedAt) => {
                current.toolActive = true;
                current.toolCallId = toolCallId ?? current.toolCallId;
                current.toolName = toolName ?? current.toolName;
                markActive(current, "tool", observedAt);
            }, "immediate");
        },
        toolExecutionUpdate(toolCallId, toolName) {
            record("tool_execution_update", (current, observedAt) => {
                current.toolActive = true;
                current.toolCallId = toolCallId ?? current.toolCallId;
                current.toolName = toolName ?? current.toolName;
                markActive(current, "tool", observedAt);
            }, "throttled");
        },
        toolResult(toolCallId, toolName) {
            record("tool_result", (current) => {
                current.toolCallId = toolCallId ?? current.toolCallId;
                current.toolName = toolName ?? current.toolName;
                refreshActiveScope(current);
            }, "immediate");
        },
        toolExecutionEnd(toolCallId, toolName) {
            record("tool_execution_end", (current, observedAt) => {
                current.toolActive = false;
                current.toolCallId = toolCallId ?? current.toolCallId;
                current.toolName = toolName ?? current.toolName;
                current.toolEndedAt = observedAt;
                refreshActiveScope(current);
            }, "immediate");
        },
        callerPing() {
            markDone("caller_ping");
        },
        subagentDone() {
            markDone("subagent_done");
        },
        taskStart() {
            if (!persistent || !taskDone)
                return;
            taskDone = false;
            record("input", (current, observedAt) => {
                current.agentActive = true;
                markActive(current, "agent", observedAt, true);
            }, "immediate");
        },
        sessionShutdown(reason) {
            if (reason === "quit")
                markDone("session_shutdown");
            else
                disable();
        },
    };
}
//# sourceMappingURL=activity-file.js.map