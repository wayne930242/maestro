import type { ThinkingLevel } from "../types.ts";
export declare const TASK_CATEGORIES: readonly ["coding", "complex-coding", "review", "recon", "qa", "architecture", "docs"];
export type TaskCategory = (typeof TASK_CATEGORIES)[number];
export declare const TASK_CATEGORY_DESCRIPTIONS: {
    coding: string;
    "complex-coding": string;
    review: string;
    recon: string;
    qa: string;
    architecture: string;
    docs: string;
};
export type TaskPreferences = Partial<Record<TaskCategory, string[]>>;
export type TaskThinkingPreferences = Partial<Record<TaskCategory, ThinkingLevel>>;
export interface TaskPreferencesMeta {
    generatedAt: string;
    method: RankingBasis["kind"];
}
/**
 * What a proposed ranking rests on, as the proposing model submitted it. It
 * travels with one write for review and is never saved; `tasksMeta.method`
 * keeps only its kind.
 */
export type RankingBasis = {
    kind: "registry-only";
} | {
    kind: "research";
    sources: [ResearchSource, ...ResearchSource[]];
    uncertainty: string;
};
export interface ResearchSource {
    /** An http(s) page the model consulted in this run. */
    url: string;
    /** How that source changed or supported the ranking. */
    influence: string;
}
//# sourceMappingURL=task-model-types.d.ts.map