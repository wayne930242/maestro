export declare const DEFAULT_MAX_PERSISTENT_AGENTS = 3;
export interface PersistentConfig {
    maxAgents: number;
}
export declare function parsePersistentConfig(rawConfig: any, source?: string): PersistentConfig;
export declare function loadPersistentConfig(configDir: string, examplePath: string): PersistentConfig;
//# sourceMappingURL=persistent-config.d.ts.map