import { type JsonObject } from "./config/type-guards.ts";
import { type OpenedPrimaryWorkspaceReport, type PrimaryWorkspaceClaim } from "./opened-primary-workspace.ts";
import type { WorktreeSurfaceInfo } from "./surface-provider.ts";
export interface CleanupGitState {
    branch: string;
    headSha: string;
    registered: boolean;
    locked: boolean;
    dirtyFiles: number;
    untrackedFiles: number;
    ignoredFiles: number;
    conflicts: number;
    submodules: boolean;
}
export interface CleanupManifest {
    file: string;
    value: JsonObject;
}
export interface HolderInspection {
    blockers: string[];
    warnings: string[];
}
export interface WorktreeInventoryEntry {
    path: string;
    sourceRepo?: string;
    branch?: string;
    workspaceId?: string;
    contained: boolean;
    git?: CleanupGitState;
    manifest: CleanupManifest[];
    classification: "eligible" | "blocked" | "unknown" | "out-of-scope";
    blockers: string[];
    warnings: string[];
}
/**
 * What cheap reads of a checkout's Git files say about it. An absent field is
 * unknown; `branch` is "" for a detached HEAD, as in CleanupGitState.
 */
export interface WorktreeIdentityHint {
    branch?: string;
    sourceRepo?: string;
}
/** All probes and effects are injectable; inventories never perform mutations. */
export interface WorktreeCleanupOperations {
    scan(): string[];
    managedRoot(): string;
    realpath(path: string): string;
    resolveSource(path: string): string | Promise<string>;
    /**
     * Identify a canonical managed checkout from its Git files alone, without a
     * subprocess. When present, removal fully inspects only the checkouts whose
     * identity is unknown or can match the target. Without it, removal inspects
     * every scanned checkout.
     */
    identify?(path: string): WorktreeIdentityHint | Promise<WorktreeIdentityHint>;
    inspectGit(path: string, sourceRepo: string): CleanupGitState | Promise<CleanupGitState>;
    listWorktrees(sourceRepo: string): WorktreeSurfaceInfo[] | Promise<WorktreeSurfaceInfo[]>;
    readManifests(): CleanupManifest[];
    holders(entry: WorktreeInventoryEntry): Promise<HolderInspection>;
    exists(path: string): boolean;
    preserve(entry: WorktreeInventoryEntry): string | Promise<string>;
    removeWorkspace(id: string): void | Promise<void>;
    /**
     * Suggest, never close, a primary workspace this process's worktree
     * creation appears to have opened. Undefined means the surface cannot report.
     */
    reportOpenedPrimaryWorkspace(sourceRepo: string, claims: readonly PrimaryWorkspaceClaim[]): OpenedPrimaryWorkspaceReport | undefined | Promise<OpenedPrimaryWorkspaceReport | undefined>;
    removeCheckout(sourceRepo: string, path: string): void | Promise<void>;
    prune(sourceRepo: string): void | Promise<void>;
    writeManifest(file: string, value: JsonObject): void;
}
export interface CleanupInput {
    cwd: string;
    operations: WorktreeCleanupOperations;
}
export interface WorktreeRemovalResult {
    status: "removed" | "blocked" | "failed" | "already-removed";
    message: string;
    warnings: string[];
    entry?: WorktreeInventoryEntry;
    preservationSha?: string;
}
export declare function cleanupBlockers(entry: WorktreeInventoryEntry): string[];
export declare function listContainedWorktrees({ cwd, operations: ops, }: CleanupInput): Promise<WorktreeInventoryEntry[]>;
export declare function formatWorktreeInventory(rows: WorktreeInventoryEntry[]): string;
export declare function removeContainedWorktree(input: CleanupInput & {
    target: string;
    preserve?: boolean;
}): Promise<WorktreeRemovalResult>;
//# sourceMappingURL=worktree-cleanup.d.ts.map