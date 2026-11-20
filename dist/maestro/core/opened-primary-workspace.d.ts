/**
 * A primary workspace this process saw Herdr open while creating a worktree.
 * The record lives only in this process. Another session is another process,
 * and a restart starts empty, so neither reports a claim. Nothing is persisted.
 */
export interface PrimaryWorkspaceClaim {
    workspaceId: string;
    repoKey: string;
    terminalId: string;
    checkoutPath: string;
}
export interface ReleasedPrimaryWorkspaceClaim {
    workspaceId: string;
    repoKey: string;
    terminalId: string;
}
/**
 * A report never closes a workspace. `note` is absent when nothing is safe to
 * suggest, and never states the attribution as fact.
 */
export interface OpenedPrimaryWorkspaceReport {
    note?: string;
    repoKey: string;
    releasedClaims: ReleasedPrimaryWorkspaceClaim[];
}
export declare function isCompletePrimaryWorkspaceClaim(value: PrimaryWorkspaceClaim): boolean;
export declare function rememberOpenedPrimaryWorkspace(claim: PrimaryWorkspaceClaim): void;
export declare function openedPrimaryWorkspaceClaims(): PrimaryWorkspaceClaim[];
export declare function forgetOpenedPrimaryWorkspaceClaims(released: readonly ReleasedPrimaryWorkspaceClaim[]): void;
export declare function clearOpenedPrimaryWorkspaceClaims(): void;
//# sourceMappingURL=opened-primary-workspace.d.ts.map