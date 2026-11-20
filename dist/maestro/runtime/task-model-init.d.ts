import { type OfferCallback, type TaskModelBrief, type TaskModelRegistryProjector, type TaskModelRegistrySnapshot } from "../core/config/task-model-init.ts";
import type { ModelConfigSnapshot } from "../core/config/model-config.ts";
/** What one init request did. Only `started` submitted a prompt. */
export type TaskModelInitOutcome = {
    kind: "started";
    destination: string;
} | {
    kind: "not-started";
    reason: string;
};
export interface TaskModelInitInput {
    preferences: string;
    /** Saved settings and the revision of the same bytes; throws when invalid. */
    readConfig(): ModelConfigSnapshot;
    /** The host supplies its actual active registry to this projector exactly once. */
    projectActiveRegistry(project: TaskModelRegistryProjector): TaskModelRegistrySnapshot;
    /** Emits the approval request for this brief and returns when listeners did. */
    emitApprovalRequest(brief: TaskModelBrief, offer: OfferCallback): void;
    /**
     * Called with the chosen destination tool before the active-tool check, so
     * the host can activate a writer it keeps inactive outside init.
     */
    activateTool?(name: string): void;
    isToolActive(name: string): boolean;
    /** Hands the prompt to Pi; a throw means Pi did not take it. */
    submit(prompt: string): void;
}
/**
 * Capture one brief, pick where its proposal goes, and submit the prompt. It
 * runs synchronously, so nothing can change between selection and submission.
 * An opened offer that is not submitted is cancelled before this returns.
 */
export declare function startTaskModelInit(input: TaskModelInitInput): TaskModelInitOutcome;
//# sourceMappingURL=task-model-init.d.ts.map