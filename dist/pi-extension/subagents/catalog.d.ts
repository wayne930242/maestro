import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { type Static } from "@sinclair/typebox";
import { type AgentCatalog, type AgentDefaults, type AgentDiagnostic, type ListedAgentDefinition, type SubagentSessionMode } from "../../maestro/core/roles/discovery.ts";
import type { TaskPreferences } from "../../maestro/core/config/task-model-types.ts";
export declare function buildSubagentRoutingGuidelines(catalog?: string, authenticatedTaskPreferences?: TaskPreferences, options?: {
    launchRoster?: boolean;
}): string[];
export declare const SubagentParams: import("@sinclair/typebox").TObject<{
    name: import("@sinclair/typebox").TString;
    task: import("@sinclair/typebox").TString;
    agent: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
    systemPrompt: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
    model: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
    thinking: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TUnion<import("@sinclair/typebox").TLiteral<"off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max">[]>>;
    item: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
    solutionSpace: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
    skills: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
    tools: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
    cwd: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
    worktree: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TObject<{
        branch: import("@sinclair/typebox").TString;
        base: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
    }>, import("@sinclair/typebox").TNull]>>;
    fork: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TBoolean>;
    persistent: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TBoolean>;
    notify: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TBoolean>;
    accept: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TObject<{
        run: import("@sinclair/typebox").TString;
        maxRetries: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TInteger>;
        timeoutSec: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TInteger>;
        paths: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TArray<import("@sinclair/typebox").TString>>;
    }>>;
    interactive: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TBoolean>;
}>;
/**
 * Resolve the effective set of denied tool names from agent defaults.
 * `spawning: false` expands to all SPAWNING_TOOLS.
 * `deny-tools` adds individual tool names on top.
 */
export declare function resolveDenyTools(agentDefs: AgentDefaults | null): Set<string>;
export declare function discoverAgentCatalog(pi?: Pick<ExtensionAPI, "events">): AgentCatalog;
export declare function missingRoleMessage(agentName: string): string;
export declare function formatVisibleAgentDefinitions(agents: ListedAgentDefinition[]): string[];
export declare function formatAgentDiagnostics(diagnostics: AgentDiagnostic[]): string[];
export declare function resolveEffectiveSessionMode(params: Static<typeof SubagentParams>, agentDefs: AgentDefaults | null): SubagentSessionMode;
interface LaunchBehavior {
    sessionMode: SubagentSessionMode;
    seededSessionMode: "lineage-only" | "fork" | null;
    inheritsConversationContext: boolean;
    taskDelivery: "direct" | "artifact";
}
export declare function resolveLaunchBehavior(params: Static<typeof SubagentParams>, agentDefs: AgentDefaults | null): LaunchBehavior;
/**
 * Decide whether a subagent is interactive (user-driven, long-running).
 *
 * Resolution order:
 *   1. Explicit `interactive` tool parameter wins.
 *   2. Explicit `interactive` frontmatter field on the agent.
 *   3. Default: the inverse of `auto-exit`. Agents that auto-exit are
 *      autonomous and the parent session should be woken on stall/recovery
 *      transitions. Agents that don't auto-exit are driven by the user in
 *      their own pane, and stall pings are noise.
 *
 * Bare `subagent({ name, task })` calls have no agent defs; they auto-exit
 * unless the caller passes `interactive: true`.
 */
export declare function resolveEffectivePersistent(params: Static<typeof SubagentParams>, agentDefs: AgentDefaults | null): boolean;
export declare function resolveEffectiveAutoExit(params: Static<typeof SubagentParams>, agentDefs: AgentDefaults | null): boolean;
export declare function resolveEffectiveInteractive(params: Static<typeof SubagentParams>, agentDefs: AgentDefaults | null): boolean;
export declare function loadAgentDefaults(agentName: string, pi?: Pick<ExtensionAPI, "events">): ListedAgentDefinition | null;
export {};
//# sourceMappingURL=catalog.d.ts.map