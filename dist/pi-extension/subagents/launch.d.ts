import { type PiLaunchSnapshot, type PiAttemptSnapshot } from "../../maestro/runtime/index.ts";
import { type ResolvedRuntimePlan, type ThinkingLevel } from "../../maestro/core/routing.ts";
import { type ModelConfig } from "../../maestro/core/config/model-config.ts";
import type { PaneConfig } from "../../maestro/core/config/pane-config.ts";
import type { SubagentRuntime } from "./state.ts";
import { SubagentParams } from "./catalog.ts";
interface LaunchPlannerDeps {
    runtime: SubagentRuntime;
    modelConfig: ModelConfig;
    paneConfig: PaneConfig;
}
export type LaunchPlanner = ReturnType<typeof createLaunchPlanner>;
/** Launch snapshots and runtime plans bound to one extension instance. */
export declare function createLaunchPlanner({ runtime, modelConfig, paneConfig, }: LaunchPlannerDeps): {
    normalizePiAttempt: (params: typeof SubagentParams.static, ctx: {
        sessionManager: {
            getSessionFile(): string | null | undefined;
            getSessionId(): string;
            getSessionDir(): string;
        };
        cwd: string;
        isProjectTrusted?: () => boolean;
        model?: {
            provider: string;
            id: string;
        };
        modelRegistry: {
            find(provider: string, modelId: string): any;
            getAvailable?: () => any[];
            getAll?: () => any[];
            hasConfiguredAuth?: (model: any) => boolean;
        };
    }, parentThinking: ThinkingLevel, options: {
        id: string;
        controlTaskId: string;
        origin: Pick<PiLaunchSnapshot["parent"], "cwd" | "invocationCwd">;
    }) => PiAttemptSnapshot;
    resolveSubagentRuntimePlans: (params: typeof SubagentParams.static, ctx: Parameters<(params: typeof SubagentParams.static, ctx: {
        sessionManager: {
            getSessionFile(): string | null | undefined;
            getSessionId(): string;
            getSessionDir(): string;
        };
        cwd: string;
        isProjectTrusted?: () => boolean;
        model?: {
            provider: string;
            id: string;
        };
        modelRegistry: {
            find(provider: string, modelId: string): any;
            getAvailable?: () => any[];
            getAll?: () => any[];
            hasConfiguredAuth?: (model: any) => boolean;
        };
    }, parentThinking: ThinkingLevel, options: {
        id: string;
        controlTaskId: string;
        origin: Pick<PiLaunchSnapshot["parent"], "cwd" | "invocationCwd">;
    }) => PiAttemptSnapshot>[1], parentThinking: ThinkingLevel) => ResolvedRuntimePlan[];
    launchSnapshot: (ctx: Parameters<(params: typeof SubagentParams.static, ctx: {
        sessionManager: {
            getSessionFile(): string | null | undefined;
            getSessionId(): string;
            getSessionDir(): string;
        };
        cwd: string;
        isProjectTrusted?: () => boolean;
        model?: {
            provider: string;
            id: string;
        };
        modelRegistry: {
            find(provider: string, modelId: string): any;
            getAvailable?: () => any[];
            getAll?: () => any[];
            hasConfiguredAuth?: (model: any) => boolean;
        };
    }, parentThinking: ThinkingLevel, options: {
        id: string;
        controlTaskId: string;
        origin: Pick<PiLaunchSnapshot["parent"], "cwd" | "invocationCwd">;
    }) => PiAttemptSnapshot>[1], thinking?: ThinkingLevel) => PiLaunchSnapshot;
};
export {};
//# sourceMappingURL=launch.d.ts.map