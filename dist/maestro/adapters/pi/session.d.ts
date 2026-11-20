import { type JsonValue } from "../../core/config/type-guards.ts";
export interface SessionEntry {
    type: string;
    id: string;
    parentId?: string | null;
    [key: string]: JsonValue | undefined;
}
export interface MessageEntry extends SessionEntry {
    type: "message";
    message: {
        role: "user" | "assistant" | "toolResult";
        content: Array<{
            type: string;
            text?: string;
            [key: string]: JsonValue | undefined;
        }>;
        stopReason?: string;
        errorMessage?: string;
    };
}
export type SeededSubagentSessionMode = "lineage-only" | "fork";
export interface WorktreeSessionFork {
    sessionFile: string;
    sourceSessionFile: string;
    handoffMessage: string;
}
export type SubagentSessionOwner = "public" | "managed-worktree";
interface PolicyWorktree {
    path: string;
    workspaceId: string;
    branch: string;
    baseSha: string;
}
export interface SubagentSessionPolicyV1 {
    version: 1;
    owner: SubagentSessionOwner;
    tools: string[] | null;
    deniedTools: string[];
    persistent: false;
}
export interface SubagentSessionPolicyV2 {
    version: 2;
    owner: SubagentSessionOwner;
    /** null deliberately means Pi's unrestricted default tool selection. */
    tools: string[] | null;
    deniedTools: string[];
    persistent: boolean;
    logicalId: string;
    generationId: string;
    policyHash: string;
    agent?: string | null;
    selfSpawn?: boolean;
    worktree?: PolicyWorktree;
}
export type SubagentSessionPolicy = SubagentSessionPolicyV1 | SubagentSessionPolicyV2;
export interface PersistentTaskEvent {
    version: 1;
    /** A `notice` belongs to no task: its `task` is "" (ADR-0019). */
    type: "task-done" | "help-request" | "notice";
    task: string;
    generation: string;
    at: string;
    message?: string;
    /** A notice's 1-based number within its generation. */
    sequence?: number;
}
export interface PersistentDeliveryLedgerEntry {
    task: string;
    outcome: "dispatched" | "delivered" | "rejected-busy" | "help-requested" | "stop-pending" | "stopped";
    generation: string;
    logicalId: string;
    policyHash: string;
    at: string;
}
export interface PersistentTaskInboxEntry {
    version: 1;
    type?: "task" | "stop";
    task: string;
    message: string;
    at: string;
}
export declare function getSubagentSessionPolicyFile(sessionFile: string): string;
/** The system-prompt flag and content a launch passed, kept for resume. */
export interface SubagentSystemPromptRecord {
    mode: "append" | "replace";
    prompt: string;
}
export declare function getSubagentSystemPromptFile(sessionFile: string): string;
export declare function writeSubagentSystemPrompt(sessionFile: string, record: SubagentSystemPromptRecord): void;
/** The launch's system prompt, or undefined when it passed none. */
export declare function readSubagentSystemPrompt(sessionFile: string): SubagentSystemPromptRecord | undefined;
export declare function getPersistentTaskEventsFile(sessionFile: string): string;
export declare function getPersistentDeliveryLedgerFile(sessionFile: string): string;
export declare function writeSubagentSessionPolicy(sessionFile: string, policy: {
    owner: SubagentSessionOwner;
    tools?: string | readonly string[];
    deniedTools: readonly string[];
    persistent?: boolean;
    logicalId?: string;
    generationId?: string;
    agent?: string | null;
    selfSpawn?: boolean;
    worktree?: PolicyWorktree;
}): SubagentSessionPolicyV2;
export declare function readSubagentSessionPolicy(sessionFile: string): SubagentSessionPolicy;
export declare function appendPersistentTaskEvent(sessionFile: string, event: Omit<PersistentTaskEvent, "version" | "at"> & {
    at?: string;
}): PersistentTaskEvent;
export declare function readPersistentTaskEvents(sessionFile: string): PersistentTaskEvent[];
export declare function appendPersistentDeliveryLedger(sessionFile: string, entry: Omit<PersistentDeliveryLedgerEntry, "at"> & {
    at?: string;
}): PersistentDeliveryLedgerEntry;
export declare function readPersistentDeliveryLedger(sessionFile: string): PersistentDeliveryLedgerEntry[];
export declare function writePersistentTaskInbox(sessionFile: string, sequence: number, entry: Omit<PersistentTaskInboxEntry, "version" | "at"> & {
    at?: string;
}): string;
export declare function consumePersistentTaskInbox(sessionFile: string): PersistentTaskInboxEntry | null;
export declare function seedSubagentSessionFile(params: {
    mode: SeededSubagentSessionMode;
    parentSessionFile: string;
    childSessionFile: string;
    childCwd: string;
}): void;
/**
 * Copy only the active Pi branch into a session rooted at another cwd.
 * Pi's native branched-session writer supplies compaction and label fidelity;
 * the temporary source-directory file is rewritten with the target cwd.
 */
export declare function createWorktreeSessionFork(params: {
    parentSessionFile: string;
    leafId: string;
    childSessionFile: string;
    childCwd: string;
    handoffMessage: string;
}): WorktreeSessionFork;
export type NoProgressClassification = "blocked-tool" | "truncated-turn" | "generic-no-progress";
export interface NoProgressSessionTail {
    classification: NoProgressClassification;
    lastEntryKind: "assistant" | "tool-result" | "message" | "other" | "none";
}
/**
 * Read only the final portion of a session when a no-progress warning is due.
 * Torn or malformed JSONL lines are ignored because Pi can be writing the tail.
 */
export declare function inspectNoProgressSessionTail(sessionFile: string): NoProgressSessionTail;
/**
 * Return the id of the last entry in the session file (current branch point / leaf).
 */
export declare function getLeafId(sessionFile: string): string | null;
/**
 * Return entries added after `afterLine` (1-indexed count of existing entries).
 */
export declare function getNewEntries(sessionFile: string, afterLine: number): SessionEntry[];
/**
 * Find the last assistant message text in a list of entries.
 *
 * Falls back to the `errorMessage` field when the last assistant message has
 * `stopReason: "error"` and no usable text content — this happens when
 * auto-retry exhausts on a provider overload / rate limit / server error, and
 * without this fallback the parent would silently see a stale earlier message.
 */
export interface ObservedSessionRuntime {
    provider?: string;
    modelId?: string;
    thinking?: string;
}
/** Read the effective model and thinking entries recorded by Pi at session startup. */
export declare function findObservedSessionRuntime(entries: SessionEntry[]): ObservedSessionRuntime;
/**
 * The model Pi restores when this session is resumed without `--model`, as
 * Pi's own `buildSessionContext()` projects it: the active branch (leaf = last
 * entry, followed through `parentId`) read in order, where each `model_change`
 * and each assistant response sets the model, so the latest one wins.
 * Undefined when the branch records no model or cannot be projected.
 */
export declare function findStoredSessionModel(entries: SessionEntry[]): {
    provider: string;
    modelId: string;
} | undefined;
export interface FinalAssistantMessage {
    text: string | null;
    contentLength: number;
    stopReason?: string;
}
/** Inspect only the final assistant message for completion evidence. */
export declare function inspectFinalAssistantMessage(entries: SessionEntry[]): FinalAssistantMessage;
/**
 * Who wrote a summary: `child` is the child's final assistant text, delivered
 * inside the report envelope; `host` is a host fallback; `child-error` is a
 * host label followed by error text the child process wrote or relayed (the
 * transcript or `.exit` sidecar errorMessage). Host and child-error summaries
 * are delivered as one encoded host line, never as host-authored prose.
 */
export type SummarySource = "child" | "host" | "child-error";
export interface AttributedSummary {
    summary: string;
    summarySource: SummarySource;
}
export declare function findLastAssistantSummary(entries: SessionEntry[]): AttributedSummary | null;
/**
 * Append a branch_summary entry to the session file.
 * Returns the new entry's id.
 */
export declare function appendBranchSummary(sessionFile: string, branchPointId: string, fromId: string | null, summary: string): string;
/**
 * Copy the session file to destDir for parallel worker isolation.
 * Returns the path of the copy.
 */
export declare function copySessionFile(sessionFile: string, destDir: string): string;
/**
 * Read new entries from sourceFile (after afterLine), append them to targetFile.
 * Returns the appended entries.
 */
export declare function mergeNewEntries(sourceFile: string, targetFile: string, afterLine: number): SessionEntry[];
export {};
//# sourceMappingURL=session.d.ts.map