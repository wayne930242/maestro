import type { ActivityReadResult, SubagentActivityState } from "../../core/types.ts";
export type SubagentShutdownReason = "quit" | "reload" | "new" | "resume" | "fork";
export interface SubagentActivityRecorder {
    sessionStart(): void;
    input(): void;
    beforeAgentStart(): void;
    agentStart(): void;
    agentEndWaiting(): void;
    agentEndDone(): void;
    turnStart(turnIndex?: number): void;
    turnEnd(turnIndex?: number): void;
    beforeProviderRequest(): void;
    afterProviderResponse(): void;
    messageUpdate(messageEventType?: string): void;
    toolExecutionStart(toolCallId?: string, toolName?: string): void;
    toolCall(toolCallId?: string, toolName?: string): void;
    toolExecutionUpdate(toolCallId?: string, toolName?: string): void;
    toolResult(toolCallId?: string, toolName?: string): void;
    toolExecutionEnd(toolCallId?: string, toolName?: string): void;
    callerPing(): void;
    subagentDone(): void;
    /** A persistent specialist received its next task: leave the done snapshot. */
    taskStart(): void;
    sessionShutdown(reason: SubagentShutdownReason): void;
}
export declare function getSubagentActivityFile(artifactDir: string, runningChildId: string): string;
export declare function readSubagentActivityFile(activityFile: string, expectedRunningChildId: string): ActivityReadResult;
export declare function writeSubagentActivityFile(activityFile: string, activity: SubagentActivityState): void;
export declare function createSubagentActivityRecorder(params: {
    runningChildId?: string;
    activityFile?: string;
    /**
     * A persistent specialist outlives each task: `done` ends the current task's
     * recording instead of the file's, and `taskStart` resumes it.
     */
    persistent?: boolean;
    now?: () => number;
}): SubagentActivityRecorder;
//# sourceMappingURL=activity-file.d.ts.map