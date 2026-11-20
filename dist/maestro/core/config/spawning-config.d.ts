export interface SpawningConfig {
    /** Deepest child a launch may create; a top-level session is depth 0. */
    maxDepth: number;
}
export declare function parseSpawningConfig(rawConfig: any, source?: string): SpawningConfig;
export declare function loadSpawningConfig(configDir: string, examplePath: string): SpawningConfig;
//# sourceMappingURL=spawning-config.d.ts.map