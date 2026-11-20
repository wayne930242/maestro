import type { NativeExecutionInspection } from "../../core/surface-provider.ts";
import { type ChildAcceptReport } from "../../core/accept.ts";
/**
 * Where a persistent child's launch line records Pi's exit code once Pi has
 * exited. Unlike the on-screen marker, a shell prompt cannot scroll it away.
 */
export declare function shellExitFileFor(sessionFile: string): string;
export interface CompletionResult {
    reason: "done" | "ping" | "sentinel" | "error";
    exitCode: number;
    ping?: {
        name: string;
        message: string;
    };
    errorMessage?: string;
    /** Who wrote errorMessage: the child's sidecar, or the host's own diagnostic. */
    errorSource?: "child" | "host";
    /** The child's own accept-check report; evidence, never the verdict. */
    accept?: ChildAcceptReport;
}
export interface CompletionOptions {
    /** Native lifetime evidence is independent of OSC agent/task status. */
    inspectExecution?: () => Promise<NativeExecutionInspection>;
    intervalMs: number;
    readTerminalTail: () => Promise<string>;
    inspectPane?: () => Promise<import("../../core/types.ts").PaneInspection>;
    /** Bounded artifact grace after explicit pane disappearance. Default: 500ms. */
    paneDisappearanceGraceMs?: number;
    onPaneInspection?: (inspection: import("../../core/types.ts").PaneInspection, observedAt: number) => void;
    sessionFile?: string;
    /** Persistent lifetime ownership cannot end on a pre-shutdown sidecar. */
    requireProcessExit?: boolean;
    /** Only launch-verified process identity, never transcript or activity state. */
    inspectProcess?: () => "alive" | "exited" | "unknown";
    /** The launch line's post-exit record ({@link shellExitFileFor}); admitted unless the identity is alive. */
    shellExitFile?: string;
    onTick?: (elapsedSeconds: number) => void;
    /** Wait for a local file wake-up or a scheduled reconciliation. */
    waitForNextCheck?: (signal: AbortSignal) => Promise<"wake" | "reconcile">;
    /** Drain local task evidence before any terminal fallback. */
    onLocalEvidence?: () => void;
}
export declare function interpretExitSidecar(payload: any): CompletionResult;
export declare function waitForCompletion(signal: AbortSignal, options: CompletionOptions): Promise<CompletionResult>;
//# sourceMappingURL=completion.d.ts.map