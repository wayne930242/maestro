export type PaneMode = "grouped" | "tab" | "split";
export type PaneDirection = "right" | "down";
export interface PaneConfig {
    mode: PaneMode;
    direction: PaneDirection;
    maxPerTab: number;
}
type PaneCreator = (name: string, cwd?: string) => string;
type SplitPaneCreator = (name: string, direction: PaneDirection, cwd?: string) => string;
type GroupedPaneCreator = (name: string, cwd: string, maxPerTab: number, direction: PaneDirection) => string;
export declare function parsePaneConfig(rawConfig: any, source?: string): PaneConfig;
export declare function loadPaneConfig(configDir: string, examplePath: string): PaneConfig;
export declare function createSubagentPaneFactory(config: PaneConfig, createTab: PaneCreator, createSplit: SplitPaneCreator, createGrouped?: GroupedPaneCreator): PaneCreator;
export {};
//# sourceMappingURL=pane-config.d.ts.map