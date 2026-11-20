import { markInterruptRequested } from "../../maestro/core/lifecycle.js";
import { encodeHostValue, HOST_ERROR_CHARS, jsonArgument, } from "../../maestro/core/host-text.js";
export const SUBAGENT_CANCEL_DESCRIPTION = "Cancel a running non-persistent subagent, including an interrupted one. " +
    "The host stops its process and delivers exactly one cancelled result, with no model fallback, retry, or recovery. Do not poll for it. " +
    "A legacy pane closes; Core confirms exit and removes its terminal record after delivery. " +
    "A worktree child keeps the workspace, checkout, commits, and manifest. " +
    "Returns confirmed, requested (launch still in flight), unconfirmed (still running and settles by itself if its pane or process is later seen gone; call again to retry), or already-terminal. " +
    "Persistent specialists are rejected; use subagent_stop.";
export const SUBAGENT_CANCEL_SNIPPET = "Cancel a running non-persistent subagent; one cancelled result arrives later";
function cancelStatusText(displayName, report, worktree) {
    const name = encodeHostValue(displayName);
    const noRetry = "No model fallback, retry, or recovery will start.";
    switch (report.status) {
        case "confirmed":
            return worktree
                ? `Cancelled subagent "${name}": its Pi process exit is confirmed; the worktree workspace, checkout, commits, and manifest are retained. ${noRetry} One cancelled result will be delivered automatically.`
                : `Cancelled subagent "${name}": its owned process exit is confirmed. ${noRetry} One cancelled result will be delivered automatically.`;
        case "requested":
            return `Cancel recorded for subagent "${name}"; its in-flight launch is terminated as soon as it is acquired. ${noRetry} One cancelled result will be delivered after termination is confirmed.`;
        case "unconfirmed":
            return `Cancel recorded for subagent "${name}", but termination is unconfirmed: ${encodeHostValue(report.error ?? "unknown error", HOST_ERROR_CHARS)}. The run stays live and owned, and settles as cancelled by itself if its pane or process is later seen gone. ${noRetry} Call subagent_cancel again to retry termination.`;
        case "already-terminal":
            return `Subagent "${name}" already reached a terminal result; nothing was cancelled.`;
    }
}
/** Interrupt and cancel controls bound to one extension instance. */
export function createControls({ runtime, updateWidget, observeRunningSubagent, }) {
    const runningSubagents = runtime.runningSubagents;
    function resolveInterruptTarget(params) {
        const requestedId = params.id?.trim();
        if (requestedId) {
            const running = runningSubagents.get(requestedId);
            return running
                ? { running }
                : {
                    error: `No running subagent with id "${encodeHostValue(requestedId)}".`,
                };
        }
        const requestedName = params.name?.trim();
        if (!requestedName) {
            return { error: "Provide a running subagent id or exact display name." };
        }
        const matches = Array.from(runningSubagents.values()).filter((running) => running.name === requestedName);
        if (matches.length === 1)
            return { running: matches[0] };
        if (matches.length === 0) {
            return {
                error: `No running subagent named "${encodeHostValue(requestedName)}".`,
            };
        }
        const candidates = matches
            .map((running) => `${encodeHostValue(running.name)} [${encodeHostValue(running.id)}]`)
            .join(", ");
        return {
            error: `Ambiguous subagent name "${encodeHostValue(requestedName)}". Matches: ${candidates}`,
        };
    }
    async function requestSubagentInterrupt(running, interruptPaneKey = () => runtime.session.interrupt(runtime.session.getControlTaskId(running.id))) {
        try {
            await interruptPaneKey(running.surface);
            return { ok: true };
        }
        catch (error) {
            return {
                error: `Failed to send Escape to subagent "${encodeHostValue(running.name)}" via herdr: ` +
                    encodeHostValue(error?.message ?? String(error), HOST_ERROR_CHARS),
            };
        }
    }
    async function handleSubagentInterrupt(params, interruptPaneKey) {
        const resolved = resolveInterruptTarget(params);
        if ("error" in resolved) {
            return {
                content: [{ type: "text", text: resolved.error }],
                details: { error: resolved.error },
            };
        }
        const running = resolved.running;
        const now = Date.now();
        observeRunningSubagent(running, now);
        const interruption = await requestSubagentInterrupt(running, interruptPaneKey);
        if ("error" in interruption) {
            return {
                content: [{ type: "text", text: interruption.error }],
                details: {
                    error: interruption.error,
                    id: running.id,
                    name: running.name,
                },
            };
        }
        running.lifecycle = markInterruptRequested(running.lifecycle, now);
        updateWidget();
        return {
            content: [
                {
                    type: "text",
                    text: `Interrupt requested for subagent "${encodeHostValue(running.name)}".`,
                },
            ],
            details: {
                id: running.id,
                name: running.name,
                status: "interrupt_requested",
            },
        };
    }
    async function handleSubagentCancel(params, session = runtime.session) {
        const fail = (error, extra = {}) => ({
            content: [{ type: "text", text: error }],
            details: { error, ...extra },
        });
        const resolved = resolveInterruptTarget(params);
        if ("error" in resolved) {
            // No live row: a retired run keeps only its consumed control ID, and a run
            // still in its initial launch has no row yet. Report the kernel's answer.
            const id = params.id?.trim();
            const report = id
                ? await session.cancel(id).catch(() => undefined)
                : undefined;
            if (!id || !report)
                return fail(resolved.error);
            updateWidget();
            return {
                content: [
                    { type: "text", text: cancelStatusText(id, report, false) },
                ],
                details: { id, status: report.status },
            };
        }
        const running = resolved.running;
        const target = { id: running.id, name: running.name };
        const shownName = encodeHostValue(running.name);
        if (running.persistent)
            return fail(`Subagent "${shownName}" is a persistent specialist; subagent_cancel does not stop it. Use subagent_stop({ id: ${jsonArgument(running.id)} }) for the graceful v1 stop.`, target);
        const control = session.getControlTaskId(running.id);
        if (!control)
            return fail(`Subagent "${shownName}" has no live owner in this session; nothing was cancelled.`, target);
        let report;
        try {
            report = await session.cancel(control);
        }
        catch (error) {
            return fail(encodeHostValue(error instanceof Error ? error.message : String(error), HOST_ERROR_CHARS), target);
        }
        finally {
            updateWidget();
        }
        const details = { ...target, status: report.status };
        if (report.requestedAt !== undefined)
            details.requestedAt = report.requestedAt;
        if (report.error)
            details.error = report.error;
        if (report.repeated)
            details.repeated = true;
        return {
            content: [
                {
                    type: "text",
                    text: cancelStatusText(running.name, report, !!running.worktree),
                },
            ],
            details,
        };
    }
    return {
        resolveInterruptTarget,
        requestSubagentInterrupt,
        handleSubagentInterrupt,
        handleSubagentCancel,
    };
}
//# sourceMappingURL=controls.js.map