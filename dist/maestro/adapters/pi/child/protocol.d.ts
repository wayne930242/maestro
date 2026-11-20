/**
 * Extension loaded into sub-agents.
 * - Shows agent identity + available tools as a compact styled widget above the editor
 * - Provides a `subagent_done` tool for interactive agents to self-terminate
 */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { consumePersistentTaskInbox } from "../session.ts";
import { type ProcessIdentityProbe } from "../process-identity.ts";
import { type ChildAcceptReport } from "../../../core/accept.ts";
export declare function shouldMarkUserTookOver(agentStarted: boolean): boolean;
export declare function shouldAutoExitOnAgentEnd(_userTookOver: boolean, messages: any[] | undefined, runAborted?: boolean): boolean;
/**
 * Event-bus channel a child asks before it ends a settled run. A listener that
 * will continue the run itself (for example after a provider quota resets)
 * sets `hold` synchronously, and the child stays open instead of exiting or
 * reporting its persistent task done.
 */
export declare const EXIT_HOLD_CHANNEL = "pi-herdr-agents:exit-hold";
export interface ExitHoldProbe {
    messages: any[] | undefined;
    hold: boolean;
}
export declare function isExitHeld(events: ExtensionAPI["events"] | undefined, messages: any[] | undefined): boolean;
export interface SubagentErrorInfo {
    errorMessage: string;
    stopReason: "error";
}
/**
 * If the last assistant message in the turn ended with `stopReason: "error"`
 * (typically auto-retry exhausted on an overload / rate limit / server error),
 * return its error info so the parent orchestrator can surface a clear
 * failure instead of silently treating the run as completed.
 *
 * Returns `null` when the latest assistant turn completed normally or was
 * aborted by the user (handled separately by shouldAutoExitOnAgentEnd).
 */
export declare function findLatestAssistantError(messages: any[] | undefined): SubagentErrorInfo | null;
export declare function buildCompletionSidecar(messages: any[] | undefined, accept?: ChildAcceptReport): {
    type: "done";
    accept?: ChildAcceptReport;
} | {
    type: "error";
    errorMessage: string;
    stopReason: "error";
};
export declare function buildPersistentTaskEvent(task: string, generation: string): {
    version: 1;
    type: "task-done";
    task: string;
    generation: string;
    at: string;
};
export declare function isPersistentStopDirective(inbox: ReturnType<typeof consumePersistentTaskInbox>): boolean;
export declare function parseDeniedTools(rawValue: string | undefined): string[];
/**
 * A managed worktree child names its own process at load from immutable
 * kernel facts, which Pi's process-title rewrite cannot alter.
 */
export declare function recordProcessIdentity(id: string | undefined, sessionFile: string | undefined, file?: string | undefined, probe?: ProcessIdentityProbe): void;
export type ChildPresentationHook = (ctx: ExtensionContext, identity: {
    subagentName: string;
    subagentAgent: string;
    toolNames: string[];
    denied: string[];
}) => void;
export declare function createChildExtension(renderWidget?: ChildPresentationHook): (pi: ExtensionAPI) => void;
declare const _default: (pi: ExtensionAPI) => void;
export default _default;
//# sourceMappingURL=protocol.d.ts.map