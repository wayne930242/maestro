export type PaneMode = "grouped" | "tab" | "split";
export type PaneDirection = "right" | "down";
export declare const DEFAULT_MIN_SPLIT_COLS = 80;
export interface PaneConfig {
    mode: PaneMode;
    direction: PaneDirection;
    maxPerTab: number;
    /** Omitted by older programmatic hosts; configuration files always resolve this value. */
    minSplitCols?: number;
}
type PaneCreator = (name: string, cwd?: string) => string;
type SplitPaneCreator = (name: string, direction: PaneDirection, cwd?: string) => string;
type GroupedPaneCreator = (name: string, cwd: string, maxPerTab: number, direction: PaneDirection) => string;
export declare function parsePaneConfig(rawConfig: any, source?: string): PaneConfig;
export declare function loadPaneConfig(configDir: string, examplePath: string): PaneConfig;
export declare function createSubagentPaneFactory(config: PaneConfig, createTab: PaneCreator, createSplit: SplitPaneCreator, createGrouped?: GroupedPaneCreator): PaneCreator;
export {};
//# sourceMappingURL=pane-config.d.ts.map