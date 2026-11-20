/**
 * The child's own accept-check loop. After a turn ends normally, run the
 * caller's check; on failure with retries left, append the bounded failing
 * output as a custom message and ask Pi for one continuation. The parent's
 * re-check, not this loop, decides the verdict.
 */
import type { AgentBeforeSettleEvent, AgentBeforeSettleEventResult } from "@earendil-works/pi-coding-agent";
import { type AcceptCommandResult, type AcceptSpec, type ChildAcceptReport } from "../../../core/accept.ts";
import { type AcceptRunner } from "../accept-runner.ts";
/** The retry message the child model reads; its output is bounded. */
export declare function acceptRetryMessage(result: AcceptCommandResult, spec: AcceptSpec, tries: number): string;
export interface ChildAcceptLoop {
    /** The latest recorded report, for the `.exit` sidecar. */
    report(): ChildAcceptReport | undefined;
    beforeSettle(event: Pick<AgentBeforeSettleEvent, "outcome" | "entries">, signal?: AbortSignal): Promise<AgentBeforeSettleEventResult | undefined>;
    /** At session shutdown: terminate a running check, bounded and awaited. */
    shutdown(): Promise<void>;
}
export declare function createChildAcceptLoop(options: {
    spec: AcceptSpec;
    cwd: string;
    runner?: AcceptRunner;
}): ChildAcceptLoop;
//# sourceMappingURL=accept-check.d.ts.map