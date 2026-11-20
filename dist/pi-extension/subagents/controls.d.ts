import type { AgentToolResult } from "@earendil-works/pi-coding-agent";
import type { PiRunSession, CancelReport } from "../../maestro/runtime/index.ts";
import type { RunningSubagent, SubagentRuntime } from "./state.ts";
import type { Observation } from "./observation.ts";
export interface SubagentInterruptDetails {
    error?: string;
    id?: string;
    name?: string;
    status?: "interrupt_requested";
}
export declare const SUBAGENT_CANCEL_DESCRIPTION: string;
export declare const SUBAGENT_CANCEL_SNIPPET = "Cancel a running non-persistent subagent; one cancelled result arrives later";
export interface SubagentCancelDetails {
    error?: string;
    id?: string;
    name?: string;
    status?: CancelReport["status"];
    requestedAt?: number;
    repeated?: boolean;
}
interface ControlDeps {
    runtime: SubagentRuntime;
    updateWidget: () => void;
    observeRunningSubagent: Observation["observeRunningSubagent"];
}
export type Controls = ReturnType<typeof createControls>;
/** Interrupt and cancel controls bound to one extension instance. */
export declare function createControls({ runtime, updateWidget, observeRunningSubagent, }: ControlDeps): {
    resolveInterruptTarget: (params: {
        id?: string;
        name?: string;
    }) => {
        running: RunningSubagent;
    } | {
        error: string;
    };
    requestSubagentInterrupt: (running: RunningSubagent, interruptPaneKey?: (surface: string) => void | Promise<void>) => Promise<{
        ok: true;
    } | {
        error: string;
    }>;
    handleSubagentInterrupt: (params: {
        id?: string;
        name?: string;
    }, interruptPaneKey?: (surface: string) => void | Promise<void>) => Promise<AgentToolResult<SubagentInterruptDetails>>;
    handleSubagentCancel: (params: {
        id?: string;
        name?: string;
    }, session?: Pick<PiRunSession, "cancel" | "getControlTaskId">) => Promise<AgentToolResult<SubagentCancelDetails>>;
};
export {};
//# sourceMappingURL=controls.d.ts.map