import type { AgentToolResult, ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { PiRunRecord, PiPersistentIO } from "../../maestro/runtime/index.ts";
import type { PersistentConfig } from "../../maestro/core/config/persistent-config.ts";
import type { WorktreeHandoff } from "../../maestro/core/worktree.ts";
import { type RunningSubagent, type SubagentRuntime } from "./state.ts";
import type { Controls } from "./controls.ts";
import { type HostField } from "./presentation.ts";
export declare function asPiRecord(running: RunningSubagent): PiRunRecord;
export declare function persistentSpecialistState(running: RunningSubagent): "idle" | "working" | "stalled" | "stopped";
export interface SubagentSendDetails {
    error?: string;
    id?: string;
    task?: string;
    inbox?: string;
    outcome?: "dispatched" | "rejected-busy";
}
interface PersistentSpecialistFacts {
    logicalId: string;
    generationId: string;
    policyHash: string;
    tasks: Array<{
        task: string;
        outcome: string;
    }>;
    sessionFile: string;
    worktree?: WorktreeHandoff;
    lastObservedPhase: string;
}
export declare function persistentSpecialistFacts(running: RunningSubagent, io: PiPersistentIO, worktree?: WorktreeHandoff): PersistentSpecialistFacts;
/**
 * Facts for a crash or stop notice. The ledger is child-writable, so its
 * outcomes are one bounded list of encoded entries with an omitted count;
 * details keep every entry.
 */
export declare function persistentFactsFields(facts: PersistentSpecialistFacts): HostField[];
export interface SubagentStopDetails {
    error?: string;
    id?: string;
    name?: string;
    status?: "stop_requested" | "stop_pending";
}
interface PersistentControlDeps {
    runtime: SubagentRuntime;
    persistentConfig: PersistentConfig;
    resolveInterruptTarget: Controls["resolveInterruptTarget"];
}
export type PersistentControls = ReturnType<typeof createPersistentControls>;
/** Persistent specialist controls bound to one extension instance. */
export declare function createPersistentControls({ runtime, persistentConfig, resolveInterruptTarget, }: PersistentControlDeps): {
    formatLivePersistentSpecialists: () => string[];
    resolvePersistentTarget: (params: {
        id?: string;
        name?: string;
    }) => {
        running: RunningSubagent;
    } | {
        error: string;
    };
    persistentCapacityError: (config?: PersistentConfig) => string | undefined;
    startPersistentStopTimeout: (running: RunningSubagent, _api: Pick<ExtensionAPI, "sendMessage">, stopTimeoutMs: number | undefined, io: PiPersistentIO) => void;
    handleSubagentStop: (params: {
        id?: string;
        name?: string;
    }, api: Pick<ExtensionAPI, "sendMessage">, stopTimeoutMs: number | undefined, io: PiPersistentIO) => AgentToolResult<SubagentStopDetails>;
    handleSubagentSend: (params: {
        id?: string;
        name?: string;
        message: string;
    }, io: PiPersistentIO) => AgentToolResult<SubagentSendDetails>;
};
export {};
//# sourceMappingURL=persistent.d.ts.map