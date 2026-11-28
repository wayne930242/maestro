import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { RunCancellation } from "../../maestro/core/types.ts";
import type { ResolvedRuntimePlan } from "../../maestro/core/routing.ts";
import type { WorktreeHandoff } from "../../maestro/core/worktree.ts";
import type { PiSpawnedAttempt } from "../../maestro/runtime/pi-run-session-types.ts";
import { type AcceptOutcome } from "../../maestro/core/accept.ts";
import type { ModelFailure, SubagentResult } from "./state.ts";
export declare function getFirstText(content: readonly {
    type: string;
    text?: string;
}[]): string;
export declare function formatElapsed(seconds: number): string;
/** Host-authored label text: a template's static part. */
export interface HostText {
    kind: "text";
    text: string;
}
/** A child-, transcript- or environment-influenced value in a host line. */
export interface HostValue {
    kind: "value";
    value: string;
    maxChars: number;
}
/** Values shown as whole encoded items within `maxChars`, then a count. */
export interface HostList {
    kind: "list";
    values: readonly string[];
    noun: string;
    maxChars: number;
}
/** An argument its builder serialized losslessly; never encoded or cut. */
export interface HostCommand {
    kind: "command";
    text: string;
}
export type HostPart = HostText | HostValue | HostList | HostCommand;
/**
 * One host line: host-authored label text (the template's static parts) and
 * the values between them. `drop` ranks a field for the whole-message budget:
 * higher ranks go first; a field without a rank is kept.
 */
export interface HostField {
    parts: readonly HostPart[];
    drop?: number;
}
export type ChildReportKind = "result" | "failure" | "help-request" | "task-result";
export interface ParentMessage {
    /** Host paragraphs before the report; never dropped. */
    head: HostField[][];
    /** The child's own output, delivered only inside the envelope. */
    report?: {
        name: string;
        kind: ChildReportKind;
        body: string;
    };
    /** Host evidence paragraphs after the report. */
    evidence?: HostField[][];
    /** End with the parent-action continuation prompt. */
    continuation?: boolean;
}
/** A display value with an explicit bound. */
export declare function value(text: string, maxChars?: number): HostValue;
export declare function list(values: readonly string[], noun: string, maxChars?: number): HostList;
/**
 * A host line from a template. Static text is host-authored by construction;
 * every interpolated string is a value the serializer encodes and bounds.
 */
export declare function hostLine(strings: TemplateStringsArray, ...values: Array<string | HostValue | HostList | HostCommand>): HostField;
/** A host line of constant host prose. */
export declare function hostText(text: string): HostField;
/** The one serializer for parent delivery messages. */
export declare function renderParentMessage(message: ParentMessage): string;
export interface ChildReportParts {
    /** Host text before the framing sentence. */
    before: string;
    report?: {
        from: string;
        kind: string;
        body: string;
    };
    /** Host evidence after the closing tag. */
    after: string;
}
/**
 * Split a delivered message into its host text and its one child report. Host
 * values are encoded and child bodies neutralized, so the first framing
 * sentence and the first closing tag after it are the host's own.
 */
export declare function splitChildReport(text: string): ChildReportParts;
/**
 * The serialized Resume line exactly as the model-facing message carries it.
 * Renderers show this line; they never rebuild a command from display text.
 */
export declare function resumeCommandLine(sessionFile: string): string;
/** Session lines; the resume command appears only in an exact one-line form. */
export declare function sessionFields(sessionFile: string | undefined): HostField[];
export declare function worktreeHandoffFields(worktree: WorktreeHandoff): HostField[];
/**
 * The verdict line, directly under the status line in the head. Unchecked
 * runs read `Check: none`. Changed check files are child-controlled names.
 */
export declare function checkField(accept: AcceptOutcome | undefined): HostField;
export interface SubagentResultDetails {
    /** The run id the launch or resume acknowledged (`details.id`). */
    id?: string;
    name: string;
    item?: string;
    task?: string;
    agent?: string;
    exitCode?: number;
    elapsed?: number;
    sessionFile?: string;
    logicalId?: string;
    generationId?: string;
    policyHash?: string;
    error?: string;
    errorMessage?: string;
    fallbackAttempts?: string[];
    fallbackFailures?: ModelFailure[];
    /** Every spawned attempt of the run in order, failed fallbacks included. */
    attempts?: PiSpawnedAttempt[];
    worktree?: WorktreeHandoff;
    runtimePlan?: ResolvedRuntimePlan;
    cancellation?: RunCancellation;
    /** The verdict and its evidence; absent means no check (`none`). */
    accept?: AcceptOutcome;
}
export interface SubagentPingDetails {
    /** The run id the launch or resume acknowledged (`details.id`). */
    id?: string;
    name: string;
    item?: string;
    /** The run's wall time until it asked, in whole seconds. */
    elapsed?: number;
    /** Every spawned attempt of the run in order, failed fallbacks included. */
    attempts?: PiSpawnedAttempt[];
    /** The name the child wrote in its sidecar, when it differs from `name`. */
    reportedName?: string;
    message: string;
    agent?: string;
    sessionFile: string;
    worktree?: WorktreeHandoff;
    accept?: AcceptOutcome;
}
/** Send one delivery message; its content always comes from the serializer. */
export declare function sendParentMessage<TDetails extends object>(api: Pick<ExtensionAPI, "sendMessage">, customType: string, message: ParentMessage, details: TDetails, options?: {
    triggerTurn: boolean;
    deliverAs?: "steer";
}): void;
/** A result: the model sees the continuation; the human view does not. */
export declare function sendSubagentResult(api: Pick<ExtensionAPI, "sendMessage">, message: ParentMessage, details: SubagentResultDetails): void;
export declare function launchDiagnosticsText(diagnostics: readonly string[] | undefined, prefix: string, suffix: string): string;
/**
 * A summary body: the child's own text is the enveloped report; a host
 * fallback or a relayed error is one encoded host line.
 */
export declare function summaryMessage(result: Pick<SubagentResult, "summary" | "summarySource">, name: string, kind: ChildReportKind): Pick<ParentMessage, "report"> & {
    head: HostField[][];
};
export declare function resolveResultPresentation(result: Pick<SubagentResult, "exitCode" | "elapsed" | "summary" | "summarySource" | "sessionFile" | "errorMessage" | "fallbackAttempts" | "fallbackFailures" | "runtimePlan" | "worktree" | "accept">, name: string, runtimeMismatch?: string): ParentMessage;
export declare function resolveCancelledPresentation(result: Pick<SubagentResult, "elapsed" | "sessionFile" | "fallbackAttempts" | "worktree" | "accept">, name: string, cancellation: RunCancellation): ParentMessage;
//# sourceMappingURL=presentation.d.ts.map