import type { TaskPreferences, TaskThinkingPreferences } from "./config/task-model-types.ts";
import type { ThinkingLevel } from "./types.ts";
export type { ThinkingLevel } from "./types.ts";
export declare const THINKING_LEVELS: readonly ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
export declare function isThinkingLevel(value: string): value is ThinkingLevel;
export type RuntimeSource = "request" | "agent" | "parent";
export interface RuntimeRequest {
    model?: string;
    thinking?: ThinkingLevel;
}
export interface ParentRuntime {
    provider: string;
    modelId: string;
    thinking: ThinkingLevel;
}
export interface RoutingModel {
    provider: string;
    id: string;
    reasoning: boolean;
    thinkingLevelMap?: Partial<Record<ThinkingLevel, string | null>>;
    input?: string[];
    contextWindow?: number;
    maxTokens?: number;
    cost?: {
        input?: number;
        output?: number;
        cacheRead?: number;
        cacheWrite?: number;
    };
}
export interface ModelRegistryAdapter {
    find(provider: string, modelId: string): RoutingModel | undefined;
    available(): RoutingModel[];
    hasConfiguredAuth(model: {
        provider: string;
        id: string;
    }): boolean;
    supportedThinkingLevels(model: RoutingModel): ThinkingLevel[];
    clampThinkingLevel(model: RoutingModel, level: ThinkingLevel): ThinkingLevel;
    /** Exact `provider/model-id` refs of the session's model scope (`--models` /
     * `enabledModels`, narrowed by an inherited {@link MODEL_SCOPE_ENV}).
     * Absent means the session is unscoped; empty means no model is in scope. */
    scope?: readonly string[];
}
export interface ResolvedRuntimePlan {
    provider: string;
    modelId: string;
    model: string;
    thinking: ThinkingLevel;
    modelSource: RuntimeSource;
    thinkingSource: RuntimeSource | "task";
    requestedModel?: string;
    requestedThinking?: ThinkingLevel;
    thinkingAdjustment?: {
        from: ThinkingLevel;
        to: ThinkingLevel;
        reason: "non-reasoning" | "inherited-clamp" | "task-clamp";
    };
    observed?: {
        model?: string;
        thinking?: ThinkingLevel;
    };
    runtimeMismatch?: string;
}
export declare class RuntimeResolutionError extends Error {
    constructor(message: string);
}
export declare function parseExactModelRef(reference: string): {
    provider: string;
    modelId: string;
} | undefined;
export interface RoutingRegistrySource {
    find(provider: string, modelId: string): any;
    getAvailable?: () => any[];
    getAll?: () => any[];
    hasConfiguredAuth?: (model: any) => boolean;
}
export declare function createModelRegistryAdapter(registry: RoutingRegistrySource, capabilities: Pick<ModelRegistryAdapter, "supportedThinkingLevels" | "clampThinkingLevel">): ModelRegistryAdapter;
export declare function scopeModelRegistryAdapter(registry: ModelRegistryAdapter, scopedRefs: ReadonlySet<string>): ModelRegistryAdapter;
/** The session's model scope, or undefined when the session is unscoped. An
 * empty scope is still a scope: no model passes it. */
export declare function modelScopeOf(registry: Pick<ModelRegistryAdapter, "scope">): readonly string[] | undefined;
/**
 * A scoped parent's exact model allowlist, carried to its child as a JSON
 * array of `provider/model-id` refs. Pi reads `--models` as patterns (globs,
 * fuzzy ids, `:thinking` suffixes) and drops the scope entirely when nothing
 * resolves, so `--models` alone can widen a child's scope. The child's routing
 * intersects its own scope with this allowlist instead.
 */
export declare const MODEL_SCOPE_ENV = "PI_SUBAGENT_MODEL_SCOPE";
/** The value a launch exports for {@link MODEL_SCOPE_ENV}; empty when unscoped. */
export declare function formatInheritedModelScope(scope: readonly string[] | undefined): string;
/**
 * Parse an inherited allowlist. Unset or empty means the parent was unscoped.
 * Anything else that is not a JSON array of strings fails closed: an empty
 * allowlist, under which no model is in scope.
 */
export declare function parseInheritedModelScope(raw: string | undefined): readonly string[] | undefined;
/**
 * This session's effective scope: its own resolved scope, narrowed to the
 * allowlist it inherited. An inherited allowlist applies even when the
 * session's own `--models` resolved to nothing, so a child never becomes
 * unscoped because its catalog failed to match the parent's refs.
 */
export declare function sessionModelScope(ownScope: readonly string[], rawInherited: string | undefined): readonly string[] | undefined;
/** Refuse a model outside a scoped session's model set; unscoped sessions pass. */
export declare function assertModelInScope(model: string, registry: Pick<ModelRegistryAdapter, "scope">, what?: string, hint?: string): void;
export declare function parseModelFallbacks(reference: string): string[];
export declare function resolveRuntimePlan(request: RuntimeRequest, agentDefaults: RuntimeRequest, parent: ParentRuntime, registry: ModelRegistryAdapter, taskThinking?: ThinkingLevel): ResolvedRuntimePlan;
/** Resolve every configured fallback before launching the first child. */
export declare function resolveRuntimePlans(request: RuntimeRequest, agentDefaults: RuntimeRequest, parent: ParentRuntime, registry: ModelRegistryAdapter, taskPreferences?: TaskPreferences, worktree?: boolean, tasksThinking?: TaskThinkingPreferences): ResolvedRuntimePlan[];
export declare function getAuthenticatedTaskPreferences(registry: ModelRegistryAdapter, taskPreferences?: TaskPreferences): TaskPreferences;
export declare function buildAuthenticatedModelCatalog(registry: ModelRegistryAdapter, limit?: number, taskPreferences?: TaskPreferences, tasksThinking?: TaskThinkingPreferences): string;
export declare function buildScopedModelCatalog(registry: ModelRegistryAdapter, scopedModels: readonly RoutingModel[], taskPreferences?: TaskPreferences, limit?: number, tasksThinking?: TaskThinkingPreferences): string;
//# sourceMappingURL=routing.d.ts.map