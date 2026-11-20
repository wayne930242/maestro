import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { PiToolRenderers } from "./presentation-hooks.ts";
import { type SubagentRuntime } from "./state.ts";
import type { PersistentControls } from "./persistent.ts";
import type { LaunchPlanner } from "./launch.ts";
import type { SpawningConfig } from "../../maestro/core/config/spawning-config.ts";
/**
 * Refuse a launch past the host-enforced delegation depth limit. The depth is
 * read from this session's own environment; see maestro/core/delegation-depth.ts.
 */
export declare function delegationDepthRefusal(maxDepth: number, env?: NodeJS.ProcessEnv): {
    message: string;
    code: string;
} | undefined;
interface LaunchToolDeps {
    renderers?: PiToolRenderers;
    shouldRegister: (name: string) => boolean;
    runtime: SubagentRuntime;
    updateWidget: () => void;
    subagentRoutingGuidelines: string[];
    persistentCapacityError: PersistentControls["persistentCapacityError"];
    resolveSubagentRuntimePlans: LaunchPlanner["resolveSubagentRuntimePlans"];
    normalizePiAttempt: LaunchPlanner["normalizePiAttempt"];
    spawningConfig: SpawningConfig;
}
/** The subagent launch tool. */
export declare function registerSubagentTool(pi: ExtensionAPI, { shouldRegister, runtime, updateWidget, subagentRoutingGuidelines, renderers, persistentCapacityError, resolveSubagentRuntimePlans, normalizePiAttempt, spawningConfig, }: LaunchToolDeps): void;
/** The subagent_resume tool. */
export declare function registerResumeTool(pi: ExtensionAPI, { shouldRegister, runtime, updateWidget, spawningConfig, renderers, }: Pick<LaunchToolDeps, "shouldRegister" | "runtime" | "updateWidget" | "spawningConfig" | "renderers">): void;
/** The /subagent command: launch a named role, or list roles. */
export declare function registerSubagentCommand(pi: ExtensionAPI): void;
export {};
//# sourceMappingURL=launch-tools.d.ts.map