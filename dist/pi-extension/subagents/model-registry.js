import { clampThinkingLevel, getSupportedThinkingLevels, } from "@earendil-works/pi-ai";
import { createModelRegistryAdapter, MODEL_SCOPE_ENV, modelScopeOf, scopeModelRegistryAdapter, sessionModelScope, } from "../../maestro/core/routing.js";
export function wrapPiModelRegistry(registry) {
    return createModelRegistryAdapter(registry, {
        supportedThinkingLevels: (model) => getSupportedThinkingLevels(asPiModel(model)),
        clampThinkingLevel: (model, level) => clampThinkingLevel(asPiModel(model), level),
    });
}
// Scoped sessions (--models / enabledModels) resolve every model selection —
// task shortlists, exact refs, fallback alternatives — against the session's
// scoped set: out-of-scope models are invisible to spawn-time resolution. A
// child also narrows its scope to the exact allowlist its parent exported, and
// stays scoped to it when its own --models resolved to nothing.
export function sessionModelRegistry(ctx, env = process.env) {
    const registry = wrapPiModelRegistry(ctx.modelRegistry);
    const ownScope = (ctx.scopedModels ?? []).map(({ model }) => `${model.provider}/${model.id}`);
    const scope = sessionModelScope(ownScope, env[MODEL_SCOPE_ENV]);
    return scope ? scopeModelRegistryAdapter(registry, new Set(scope)) : registry;
}
/** The models a scoped session's catalog lists, or undefined when unscoped. */
export function sessionScopedModels(ctx, registry) {
    const scope = modelScopeOf(registry);
    if (!scope)
        return undefined;
    const inScope = new Set(scope);
    const own = (ctx.scopedModels ?? [])
        .map(({ model }) => model)
        .filter((model) => inScope.has(`${model.provider}/${model.id}`));
    // Only an inherited allowlist applies: list what the registry resolves.
    return own.length > 0 ? own : registry.available();
}
function asPiModel(model) {
    return {
        provider: model.provider,
        id: model.id,
        name: model.id,
        api: "openai-completions",
        baseUrl: "",
        reasoning: model.reasoning,
        thinkingLevelMap: model.thinkingLevelMap,
        input: model.input?.filter((entry) => entry === "text" || entry === "image") ?? ["text"],
        contextWindow: model.contextWindow ?? 0,
        maxTokens: model.maxTokens ?? 0,
        cost: {
            input: model.cost?.input ?? 0,
            output: model.cost?.output ?? 0,
            cacheRead: model.cost?.cacheRead ?? 0,
            cacheWrite: model.cost?.cacheWrite ?? 0,
        },
    };
}
//# sourceMappingURL=model-registry.js.map