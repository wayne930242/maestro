import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { PaneConfig } from "../../maestro/core/config/pane-config.ts";
import { type CleanupInput } from "../../maestro/core/worktree-cleanup.ts";
import type { SubagentRuntime } from "./state.ts";
interface WorktreeDeps {
    runtime: SubagentRuntime;
    parentSession: boolean;
    cleanupInput: (ctx: ExtensionContext) => CleanupInput;
    paneConfig: PaneConfig;
}
/** Parent-only worktree inventory and removal tools. */
export declare function registerWorktreeTools(pi: ExtensionAPI, { parentSession, cleanupInput, }: Pick<WorktreeDeps, "parentSession" | "cleanupInput">): void;
/** The /worktree command: fork into a worktree, list, or remove one. */
export declare function registerWorktreeCommand(pi: ExtensionAPI, { runtime, parentSession, cleanupInput, paneConfig }: WorktreeDeps): void;
export {};
//# sourceMappingURL=worktree-tools.d.ts.map