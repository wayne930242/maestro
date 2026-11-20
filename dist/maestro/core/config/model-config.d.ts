import { type RankingBasis, type TaskCategory, type TaskPreferences, type TaskPreferencesMeta, type TaskThinkingPreferences } from "./task-model-types.ts";
export interface ModelConfig {
    default?: string;
    agents: Record<string, string>;
    tasks?: TaskPreferences;
    tasksThinking?: TaskThinkingPreferences;
    tasksMeta?: TaskPreferencesMeta;
}
export declare function parseModelConfig(rawConfig: any, source?: string): ModelConfig;
export declare function resolveModelDefault(agentName: string | undefined, agentModel: string | undefined, config: ModelConfig): string | undefined;
export declare function loadModelConfig(configDir: string): ModelConfig;
export interface ModelConfigSnapshot {
    config: ModelConfig;
    /** Revision of the exact bytes `config` was parsed from. */
    revision: string;
}
/** Parse the saved model settings and revision them from one read of the file. */
export declare function readModelConfigSnapshot(configDir: string): ModelConfigSnapshot;
/**
 * Validate a writer call's optional ranking basis against its tasksMeta.method.
 * Code checks shape and consistency only; it cannot prove a source was read.
 */
export declare function parseRankingBasis(value: any, method: TaskPreferencesMeta["method"]): RankingBasis;
export interface SavedTaskModelConfig {
    configPath: string;
    tasks: TaskPreferences;
    tasksThinking?: TaskThinkingPreferences;
    tasksMeta: TaskPreferencesMeta | undefined;
    missingCategories: TaskCategory[];
    /** Revision of the exact bytes this call published. */
    configRevision: string;
}
/** Revision of an absent config file. */
export declare const MISSING_CONFIG_REVISION = "missing";
/** `sha256:<lowercase hex>` over the exact file bytes, never normalized JSON. */
export declare function computeConfigRevision(bytes: Uint8Array): string;
export declare function isConfigRevision(value: any): value is string;
/** Read the exact-byte revision of a config file, or `missing` when absent. */
export declare function readConfigRevision(configPath: string): string;
export type TaskModelConfigWriteErrorCode = "invalid-revision" | "stale-revision" | "busy";
export declare class TaskModelConfigWriteError extends Error {
    readonly code: TaskModelConfigWriteErrorCode;
    constructor(code: TaskModelConfigWriteErrorCode, message: string);
}
export interface WriteTaskModelConfigOptions {
    /** Replaces category thinking when supplied; omitted preserves it for retained categories. */
    tasksThinking?: TaskThinkingPreferences | null;
    /** Exact precomputed replacement and real directory shown for approval. */
    approvedWrite?: PreparedTaskModelWrite;
    /**
     * Exact-byte revision the caller proposed against. Omitted keeps the
     * unconditional write; `missing` requires the file to be absent.
     */
    expectedConfigRevision?: string;
    fileOperations?: Pick<typeof import("node:fs"), "renameSync" | "writeFileSync">;
}
/** Normalize and validate a proposal without creating files or acquiring a lock. */
export declare function validateTaskModelProposal(configPath: string, tasks: TaskPreferences, tasksMeta: TaskPreferencesMeta, isAuthenticatedCandidate: (candidate: string) => boolean, options?: WriteTaskModelConfigOptions): ModelConfig;
/** Check the proposal's revision before approval and again under the write lock. */
export declare function assertTaskModelConfigRevision(configPath: string, expected: string | undefined, actual: string): void;
/** Legacy callers preserve thinking only for task categories they retain. */
export declare function resolveTaskThinkingPreferences(tasks: TaskPreferences | undefined, requested: TaskThinkingPreferences | undefined, previous: TaskThinkingPreferences | undefined): TaskThinkingPreferences | undefined;
export interface PreparedTaskModelWrite {
    configPath: string;
    realConfigPath: string;
    realConfigDir: string;
    configRevision: string;
    before: ModelConfig;
    after: ModelConfig;
    output: string;
    newFile: boolean;
    topLevelKeys: string[];
}
/** Read and compute every byte before approval, including the minimal new-file seed. */
export declare function prepareTaskModelWrite(configPath: string, candidate: ModelConfig, expectedConfigRevision?: string): PreparedTaskModelWrite;
/** Best-effort re-read after an approved write throws; never infer that failure means no publication. */
export declare function describeTaskModelWriteFailure(approved: PreparedTaskModelWrite): string;
/**
 * Atomically replace models.tasks, category thinking and models.tasksMeta in the durable user config.
 * `_examplePath` is retained for positional compatibility only; missing files
 * receive the minimal status setting and proposed models, never an example seed.
 * Every other top-level key of an existing file is kept, and the published file
 * is mode 0600.
 *
 * Cooperating calls use an exclusive sibling lock around snapshot validation
 * and temporary-file publication. Non-cooperating processes can unlink it, so
 * continued ownership is not guaranteed. It serializes cooperating writers only and
 * cannot constrain editors or processes that ignore it. Contention and stale locks
 * fail closed without waiting or breaking another owner's lock.
 */
export declare function writeTaskModelConfig(configPath: string, _examplePath: string, tasks: TaskPreferences, tasksMeta: TaskPreferencesMeta, isAuthenticatedCandidate: (candidate: string) => boolean, options?: WriteTaskModelConfigOptions): SavedTaskModelConfig;
/** The published config file is owner read/write only (#149). */
export declare const CONFIG_FILE_MODE = 384;
/** Sibling advisory lock path shared by every cooperating config writer. */
export declare function getConfigWriteLockPath(configPath: string): string;
//# sourceMappingURL=model-config.d.ts.map