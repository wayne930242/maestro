import { type ThinkingLevel } from "../routing.ts";
import type { Role } from "../types.ts";
export type SubagentSessionMode = "standalone" | "lineage-only" | "fork";
export interface AgentDefaults {
    model?: string;
    tools?: string;
    skills?: string;
    thinking?: ThinkingLevel;
    denyTools?: string;
    spawning?: boolean;
    selfSpawn?: boolean;
    persistent?: boolean;
    autoExit?: boolean;
    interactive?: boolean;
    systemPromptMode?: "append" | "replace";
    sessionMode?: SubagentSessionMode;
    cwd?: string;
    body?: string;
    disableModelInvocation?: boolean;
}
type AgentSource = "package" | "global" | "project";
interface AgentDefinition extends AgentDefaults {
    name: string;
    description?: string;
    disableModelInvocation: boolean;
}
export interface ListedAgentDefinition extends AgentDefinition {
    /** Runtime role plus the unchanged raw listing/validation metadata above. */
    role: Role;
    source: AgentSource;
    path: string;
    provider?: string;
    providerVersion?: string;
}
export interface AgentDiagnostic {
    code: string;
    message: string;
    path?: string;
    agentName?: string;
    provider?: string;
}
export interface AgentCatalog {
    agents: ListedAgentDefinition[];
    diagnostics: AgentDiagnostic[];
}
export declare const ROLE_PACK_DISCOVERY_EVENT = "pi-herdr-subagents:roles:discover:v1";
export interface RolePackDiscoveryEvent {
    apiVersion: 1;
    register(path: string): void;
}
export interface RoleDiscoveryOptions {
    agentConfigDir: string;
    cwd: string;
    onRolePackDiscovered?(event: RolePackDiscoveryEvent): void;
}
interface RolePackDiscoveryResult {
    paths: string[];
    diagnostics: AgentDiagnostic[];
}
export declare function discoverRolePackPaths(onRolePackDiscovered?: RoleDiscoveryOptions["onRolePackDiscovered"]): RolePackDiscoveryResult;
export declare function discoverAgentCatalog(options: RoleDiscoveryOptions): AgentCatalog;
export declare function discoverAgentDefinitions(options: RoleDiscoveryOptions): ListedAgentDefinition[];
export {};
//# sourceMappingURL=discovery.d.ts.map