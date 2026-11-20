import { type JsonObject } from "../core/config/type-guards.ts";
import { realpathWithoutOpening } from "../core/realpath-without-opening.ts";
import type { SurfaceProvider } from "../core/surface-provider.ts";
import type { HolderInspection, WorktreeCleanupOperations } from "../core/worktree-cleanup.ts";
import { type WorktreeLaunch, type WorktreeHandoff, type WorktreeResultState, type WorktreeOperations } from "../core/worktree.ts";
export declare const GIT_BASE_TIMEOUT_MS = 10000;
export declare const GIT_SOURCE_TIMEOUT_MS = 15000;
export declare const GIT_HANDOFF_TIMEOUT_MS = 15000;
export declare function resolveGitCommit(cwd: string, ref: string): Promise<string>;
/** Total wall time for seeding every project package dir of one launch. */
export declare const PROJECT_PACKAGE_SEED_TIMEOUT_MS = 60000;
/**
 * Seeds a new managed worktree with the source checkout's installed project
 * packages (`.pi/npm`, `.pi/git`), which are gitignored and so never reach the
 * worktree. Without them the child's Pi installs them at startup, which can
 * outlast launch readiness. Pi reads project packages relative to its own
 * cwd (the worktree root), even when the source project was a subdirectory.
 * Returns warnings; it never throws.
 */
export declare function seedProjectPackages(sourceCwd: string, targetCwd: string): Promise<string[]>;
export declare function resolveWorktreeProvisionCwd(sourceCwd: string): Promise<string>;
export declare function readWorktreeManifest(path: string): JsonObject | undefined;
export declare function writeWorktreeManifest(path: string, value: JsonObject): void;
export declare function captureWorktreeHandoff(worktree: WorktreeLaunch, timeoutMs?: number): Promise<WorktreeHandoff>;
export declare function persistWorktreeResult(worktree: WorktreeLaunch, state: WorktreeResultState, handoff?: WorktreeHandoff): void;
/** Individual visibility gaps warn; failed enumeration still blocks cleanup. */
declare function processHolders(path: string, idleShellPids?: Set<number>, procRoot?: string, platform?: NodeJS.Platform): HolderInspection;
export declare const __worktreeCleanupTest__: {
    processHolders: typeof processHolders;
    realpathWithoutOpening: typeof realpathWithoutOpening;
};
export declare function createWorktreeCleanupOperations(provider: SurfaceProvider, input: {
    manifestDir: string;
    liveHolders: () => {
        path: string;
        persistent?: boolean;
    }[];
    managedRoot?: string;
}): WorktreeCleanupOperations;
export declare function createWorktreeOperations(): WorktreeOperations;
export {};
//# sourceMappingURL=worktree-operations.d.ts.map