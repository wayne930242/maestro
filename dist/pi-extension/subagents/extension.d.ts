import type { ExtensionAPI, ExtensionContext, SessionShutdownEvent } from "@earendil-works/pi-coding-agent";
import { type PiRunSessionInfrastructure } from "../../maestro/runtime/index.ts";
import { sessionModelRegistry } from "./model-registry.ts";
import type { WorktreeCleanupOperations } from "../../maestro/core/worktree-cleanup.ts";
import { type SubagentResult, type RunningSubagent, hasWorkingSubagents, shouldDeliverSubagentCompletion, selectCompletionApi } from "./state.ts";
import { buildSubagentRoutingGuidelines, resolveDenyTools, discoverAgentCatalog, resolveEffectiveSessionMode, resolveLaunchBehavior, resolveEffectiveAutoExit, resolveEffectiveInteractive, loadAgentDefaults } from "./catalog.ts";
import { sendSubagentResult, resolveResultPresentation } from "./presentation.ts";
import type { PiPresentationHooks } from "./presentation-hooks.ts";
import type { HostSurfaceBinding } from "../../maestro/runtime/host-surface-binding.ts";
import { formatNoProgressAdvisoryLine } from "./observation.ts";
import { persistentSpecialistState } from "./persistent.ts";
export { hasWorkingSubagents, shouldDeliverSubagentCompletion, selectCompletionApi, };
export declare function shouldPreserveSubagentsOnShutdown(reason: SessionShutdownEvent["reason"] | undefined): boolean;
export declare function cleanupSubagentsForShutdown(reason: SessionShutdownEvent["reason"] | undefined, agents: Map<string, Pick<RunningSubagent, "abortController" | "lifecycle">>): void;
export declare function shouldAdvanceToFallback(result: Pick<SubagentResult, "errorMessage">, remainingPlans: number, persistent?: boolean): boolean;
declare function shouldRetainSubagentSurface(running: Pick<RunningSubagent, "worktree"> | {
    worktree?: unknown;
}): boolean;
export interface PiHostOptions {
    hostSurface: HostSurfaceBinding;
    presentation: PiPresentationHooks;
    childEntryPath?: string;
    configAssetRoot?: string;
    configExamplePath?: string;
}
/** Invoked once by the terminal entry on every Pi load, including /reload. */
export declare function createPiExtension(hostOptions: PiHostOptions): ((pi: ExtensionAPI, options?: {
    cleanupOperations?: (ctx: ExtensionContext) => WorktreeCleanupOperations;
    infrastructure?: PiRunSessionInfrastructure;
    /** Host platform for the Windows support scope; tests inject win32. */
    platform?: NodeJS.Platform;
}) => void) & {
    __test__: {
        borderLine: (left: string, right: string, width: number, accent?: string) => string;
        renderSubagentWidgetLines: (agents: RunningSubagent[], width: number) => string[];
        updateWidget: () => void;
        loadAgentDefaults: typeof loadAgentDefaults;
        discoverAgentCatalog: typeof discoverAgentCatalog;
        resolveEffectiveSessionMode: typeof resolveEffectiveSessionMode;
        resolveLaunchBehavior: typeof resolveLaunchBehavior;
        resolveEffectiveAutoExit: typeof resolveEffectiveAutoExit;
        resolveEffectiveInteractive: typeof resolveEffectiveInteractive;
        observeRunningSubagent: (running: RunningSubagent, observedAt?: number) => void;
        evaluateNoProgressAdvisory: (running: RunningSubagent, projection: import("../../maestro/core/types.ts").LifecycleProjection, now: number, hangWarningMinutes: number, inspectProgress?: (running: RunningSubagent) => import("./state.ts").NoProgressSessionTail) => ({
            kind: "warning";
            idleMs: number;
            classification: import("./state.ts").NoProgressClassification;
            lastEntryKind: import("./state.ts").NoProgressSessionTail["lastEntryKind"];
            notify: boolean;
        } | {
            kind: "recovered";
            idleMs: number;
            classification: import("./state.ts").NoProgressClassification;
            lastEntryKind: import("./state.ts").NoProgressSessionTail["lastEntryKind"];
            notify: boolean;
        }) | undefined;
        formatNoProgressAdvisoryLine: typeof formatNoProgressAdvisoryLine;
        resolveDenyTools: typeof resolveDenyTools;
        buildSubagentRoutingGuidelines: typeof buildSubagentRoutingGuidelines;
        sessionModelRegistry: typeof sessionModelRegistry;
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
        }, interruptPaneKey?: (surface: string) => void | Promise<void>) => Promise<import("@earendil-works/pi-coding-agent").AgentToolResult<import("./controls.ts").SubagentInterruptDetails>>;
        handleSubagentSend: (params: {
            id?: string;
            name?: string;
            message: string;
        }, io: import("../../maestro/runtime/pi-run-session-types.ts").PiPersistentIO) => import("@earendil-works/pi-coding-agent").AgentToolResult<import("./persistent.ts").SubagentSendDetails>;
        handleSubagentStop: (params: {
            id?: string;
            name?: string;
        }, api: Pick<ExtensionAPI, "sendMessage">, stopTimeoutMs: number | undefined, io: import("../../maestro/runtime/pi-run-session-types.ts").PiPersistentIO) => import("@earendil-works/pi-coding-agent").AgentToolResult<import("./persistent.ts").SubagentStopDetails>;
        persistentSpecialistState: typeof persistentSpecialistState;
        persistentCapacityError: (config?: import("../../maestro/core/config/persistent-config.ts").PersistentConfig) => string | undefined;
        resolveResultPresentation: typeof resolveResultPresentation;
        shouldAdvanceToFallback: typeof shouldAdvanceToFallback;
        deliverPersistentTaskEvent: (running: RunningSubagent, event: import("../../maestro/runtime/pi-run-session-types.ts").PiPersistentEvent, api: Pick<ExtensionAPI, "sendMessage">, io: import("../../maestro/runtime/pi-run-session-types.ts").PiPersistentIO, ledgerSnapshot?: import("../../maestro/runtime/pi-run-session-types.ts").PiLedgerEntry[]) => void;
        drainPersistentTaskEvents: (running: RunningSubagent, api: Pick<ExtensionAPI, "sendMessage">, io: import("../../maestro/runtime/pi-run-session-types.ts").PiPersistentIO) => void;
        notifyPersistentCrash: (running: RunningSubagent, api: Pick<ExtensionAPI, "sendMessage">, io: import("../../maestro/runtime/pi-run-session-types.ts").PiPersistentIO, worktree?: import("../../maestro/core/worktree.ts").WorktreeHandoff) => void;
        sendSubagentResult: typeof sendSubagentResult;
        shouldRetainSubagentSurface: typeof shouldRetainSubagentSurface;
        formatLivePersistentSpecialists: () => string[];
        runningSubagents: Map<string, RunningSubagent>;
    };
};
//# sourceMappingURL=extension.d.ts.map