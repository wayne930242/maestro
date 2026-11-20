export interface RoleConfig {
    /** Accepted no-op settings, each with actionable migration text. */
    deprecations: string[];
}
export declare function parseRoleConfig(rawConfig: any, source?: string): RoleConfig;
export declare function loadRoleConfig(configDir: string, examplePath: string): RoleConfig;
//# sourceMappingURL=role-config.d.ts.map