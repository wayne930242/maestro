import type { RoutingModel } from "../routing.ts";
import type { ThinkingLevel } from "../types.ts";
import type { ModelConfig } from "./model-config.ts";
import { TASK_CATEGORY_DESCRIPTIONS } from "./task-model-types.ts";
/**
 * Retained v1 compatibility handoff while host init runs. An extension may
 * still offer its existing pre-approval flow; every eventual host writer call
 * separately requires user approval and cannot be authorized by this event.
 */
export declare const TASK_MODEL_INIT_APPROVAL_EVENT = "pi-herdr-subagents:task-models:init:approval:v1";
/**
 * Emitted by another extension's command to start host init. The host offers
 * to run it; the emitter starts it only if exactly one host offered.
 */
export declare const TASK_MODEL_INIT_START_EVENT = "pi-herdr-subagents:task-models:init:start:v1";
export declare const DIRECT_WRITER_TOOL = "subagents_write_task_models";
export type NonEmpty<T> = [T, ...T[]];
/** Raw local registry facts needed by the injected projector; no SDK ownership. */
export interface TaskModelRegistrySource {
    getAvailable(): (RoutingModel & {
        name?: string;
    })[];
    getRegisteredProviderIds?(): readonly string[];
    getProviderAuthStatus?(provider: string): {
        source?: string;
    } | undefined;
}
/** Sanitized, complete active-registry snapshot. Missing metadata remains unknown. */
export interface TaskModelFacts {
    ref: string;
    provider: string;
    id: string;
    name?: string;
    extensionRegistered?: boolean;
    auth: {
        configured: true;
        source?: string;
    };
    reasoning: boolean;
    supportedThinkingLevels: ThinkingLevel[];
    input?: string[];
    contextWindow?: number;
    maxTokens?: number;
    cost?: RoutingModel["cost"];
}
export interface TaskModelRegistrySnapshot {
    models: TaskModelFacts[];
}
export type TaskModelRegistryProjector = (registry: TaskModelRegistrySource) => TaskModelRegistrySnapshot;
/** One init request's inputs. An empty registry never becomes a brief. */
export interface TaskModelBrief {
    operatorPreferences: string;
    categories: typeof TASK_CATEGORY_DESCRIPTIONS;
    /** Revision of the exact config bytes `current` was parsed from. */
    configRevision: string;
    current: ModelConfig;
    models: NonEmpty<TaskModelFacts>;
}
export declare function buildTaskModelBrief(input: {
    models: NonEmpty<TaskModelFacts>;
    current: ModelConfig;
    configRevision: string;
    preferences: string;
}): TaskModelBrief;
/** The tool the drafted proposal goes to, and the prompt text that says how. */
export interface TaskModelInitDestination {
    toolName: string;
    instructions: string;
}
/** The host's own writer, used when no extension offers its legacy approval flow. */
export declare const DIRECT_WRITER_DESTINATION: TaskModelInitDestination;
export declare function buildTaskModelInitPrompt(brief: TaskModelBrief, destination: TaskModelInitDestination): string;
/** One extension's legacy pre-approval/write flow for an init request. The host writer still prompts. */
export interface ApprovalOffer {
    owner: string;
    /** Foreign code; openApprovalOffer parses what it returns. */
    open(): any;
}
/** Passed to listeners; it accepts offers only while the request is emitted. */
export type OfferCallback = (offer: any) => "recorded" | "closed";
/** Everything listeners answered during one emit, kept separate until selection. */
export interface ApprovalOffers {
    offers: ApprovalOffer[];
    problems: string[];
}
export type ApprovalRoute = {
    kind: "direct";
} | {
    kind: "offer";
    offer: ApprovalOffer;
} | {
    kind: "refused";
    reason: string;
};
export type OpenedApproval = {
    kind: "ready";
    destination: TaskModelInitDestination;
    /** Closes the opened flow; returns why it could not, if it could not. */
    cancel(): string | undefined;
} | {
    kind: "blocked";
    reason: string;
};
/**
 * Emit one request and keep what listeners offered while `emit` ran. A listener
 * must offer before its first await: once `emit` returns, `offer` answers
 * "closed" and records nothing. Offers are only recorded here, never invoked.
 */
export declare function collectApprovalOffers(emit: (offer: OfferCallback) => void): ApprovalOffers;
/** Zero offers keep the host writer; anything but exactly one valid offer refuses. */
export declare function selectApprovalRoute(collected: ApprovalOffers): ApprovalRoute;
/**
 * Open the selected offer synchronously. Any failure blocks; nothing falls
 * back. A ready result must carry `cancel`, which the host calls when it does
 * not submit the prompt, so no opened flow waits for a prompt that never comes.
 */
export declare function openApprovalOffer(offer: ApprovalOffer): OpenedApproval;
//# sourceMappingURL=task-model-init.d.ts.map