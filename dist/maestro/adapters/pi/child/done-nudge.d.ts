/**
 * Asks a child that ended a run without subagent_done whether its task is
 * complete. A child without auto-exit stays open until it calls subagent_done,
 * and one that forgets leaves its caller waiting on a session that has stopped
 * working.
 */
export declare const DONE_NUDGE_DELAY_MS = 3000;
export declare const DONE_NUDGE_MESSAGE: string;
export interface DoneNudgeContext {
    isIdle(): boolean;
    hasPendingMessages(): boolean;
    ui?: {
        getEditorText?(): string;
    };
}
export interface DoneNudgeOptions {
    send(message: string): void;
    isBusy(): boolean;
}
export interface DoneNudge {
    runStarting(): void;
    settled(messages: readonly {
        role?: string;
        stopReason?: string;
    }[] | undefined, aborted: boolean, ctx: DoneNudgeContext): void;
    cancel(): void;
}
/** A run that ended on its own, not by an abort or a provider error. */
export declare function endedNormally(messages: readonly {
    role?: string;
    stopReason?: string;
}[] | undefined): boolean;
/**
 * Speaks at most once per run that something else started, so a child that
 * answers "waiting" is not asked again until new input arrives.
 */
export declare function createDoneNudge(options: DoneNudgeOptions): DoneNudge;
//# sourceMappingURL=done-nudge.d.ts.map