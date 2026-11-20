/** Settings for the guidelines the host injects into the parent's system prompt. */
export interface GuidelinesConfig {
    /** Ask the parent to print a roster table after the final launch. */
    launchRoster: boolean;
}
export declare function parseGuidelinesConfig(rawConfig: any, source?: string): GuidelinesConfig;
export declare function loadGuidelinesConfig(configDir: string, examplePath: string): GuidelinesConfig;
//# sourceMappingURL=guidelines-config.d.ts.map