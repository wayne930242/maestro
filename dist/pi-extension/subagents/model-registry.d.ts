import { type ModelRegistryAdapter, type RoutingModel, type RoutingRegistrySource } from "../../maestro/core/routing.ts";
export declare function wrapPiModelRegistry(registry: RoutingRegistrySource): ModelRegistryAdapter;
interface SessionModelContext {
    modelRegistry: RoutingRegistrySource;
    scopedModels?: readonly {
        model: RoutingModel;
    }[];
}
export declare function sessionModelRegistry(ctx: SessionModelContext, env?: NodeJS.ProcessEnv): ModelRegistryAdapter;
/** The models a scoped session's catalog lists, or undefined when unscoped. */
export declare function sessionScopedModels(ctx: SessionModelContext, registry: ModelRegistryAdapter): RoutingModel[] | undefined;
export {};
//# sourceMappingURL=model-registry.d.ts.map