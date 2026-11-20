export interface SupervisionConfig {
    forcePolling: boolean;
    hangWarningMinutes: number;
}
export declare function parseSupervisionConfig(rawConfig: any, source?: string): SupervisionConfig;
export declare function loadSupervisionConfig(configDir: string, examplePath: string): SupervisionConfig;
//# sourceMappingURL=supervision-config.d.ts.map