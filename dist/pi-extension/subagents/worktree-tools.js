import { HostEncodedError } from "./tool-boundary.js";
import { ROUTINE_TOOL_EXPOSURE } from "./deferred-tools.js";
import { Type } from "@sinclair/typebox";
import { resolveRuntimePlan, isThinkingLevel, } from "../../maestro/core/routing.js";
import { sessionModelRegistry } from "./model-registry.js";
import { getAgentConfigDir } from "./config-path.js";
import { listContainedWorktrees, removeContainedWorktree, formatWorktreeInventory, } from "../../maestro/core/worktree-cleanup.js";
import { delegationDepthRefusal } from "./launch-tools.js";
import { launchDiagnosticsText } from "./presentation.js";
import { encodeHostValue, HOST_ERROR_CHARS, HOST_PATH_CHARS, } from "../../maestro/core/host-text.js";
function errorText(message) {
    return encodeHostValue(message, HOST_ERROR_CHARS);
}
/** Parent-only worktree inventory and removal tools. */
export function registerWorktreeTools(pi, { parentSession, cleanupInput, }) {
    if (parentSession) {
        pi.registerTool({
            name: "worktree_list",
            exposure: ROUTINE_TOOL_EXPOSURE,
            label: "Worktree inventory",
            description: "List managed worktrees, including orphans from other sessions. Read-only.",
            parameters: Type.Object({}),
            execute: async (_id, _params, _signal, _update, ctx) => {
                const entries = await listContainedWorktrees(cleanupInput(ctx));
                return {
                    content: [{ type: "text", text: formatWorktreeInventory(entries) }],
                    details: { entries },
                };
            },
        });
        pi.registerTool({
            name: "worktree_remove",
            exposure: ROUTINE_TOOL_EXPOSURE,
            label: "Remove worktree",
            description: "Remove one managed worktree by exact path, branch, or workspace ID, only when the user asks. Its source repository must be inside cwd. Branches and commits are kept. A dirty worktree needs preserve: true, which commits the work first.",
            parameters: Type.Object({
                target: Type.String({ minLength: 1 }),
                preserve: Type.Optional(Type.Boolean()),
            }),
            execute: async (_id, params, _signal, _update, ctx) => {
                const result = await removeContainedWorktree({
                    ...cleanupInput(ctx),
                    ...params,
                });
                if (result.status === "blocked" || result.status === "failed")
                    throw new HostEncodedError(result.message);
                return {
                    content: [{ type: "text", text: result.message }],
                    details: result,
                };
            },
        });
    }
}
/** The /worktree command: fork into a worktree, list, or remove one. */
export function registerWorktreeCommand(pi, { runtime, parentSession, cleanupInput, paneConfig }) {
    pi.registerCommand("worktree", {
        description: parentSession
            ? "Fork into a worktree, list retained worktrees, or explicitly remove one"
            : "Fork this session into a worktree; use /worktree list to inspect them",
        handler: async (args, ctx) => {
            // Every /worktree form operates on managed worktrees.
            const platformRefusal = runtime.session.managedWorktreeRefusal();
            if (platformRefusal) {
                ctx.ui.notify(platformRefusal, "error");
                return;
            }
            const trimmed = args.trim();
            const parts = trimmed.split(/\s+/).filter(Boolean);
            if (trimmed === "list") {
                if (!runtime.session.availability().available) {
                    ctx.ui.notify(runtime.session.availability().setupHint, "error");
                    return;
                }
                try {
                    ctx.ui.notify(parentSession
                        ? formatWorktreeInventory(await listContainedWorktrees(cleanupInput(ctx)))
                        : (await runtime.session.listWorktreeSurfaces({ cwd: ctx.cwd }))
                            .map((worktree) => `${worktree.branch ? encodeHostValue(worktree.branch) : "(detached HEAD)"} — ${encodeHostValue(worktree.path, HOST_PATH_CHARS)}${worktree.workspaceId ? ` (${encodeHostValue(worktree.workspaceId)})` : ""}`)
                            .join("\n") || "No worktrees found.", "info");
                }
                catch (error) {
                    ctx.ui.notify(`Worktree list failed: ${errorText(error instanceof Error ? error.message : String(error))}`, "error");
                }
                return;
            }
            if (parts[0] === "remove") {
                if (!parentSession) {
                    ctx.ui.notify("Worktree removal is parent-only.", "warning");
                    return;
                }
                const preserve = parts.at(-1) === "--preserve";
                const target = trimmed
                    .slice("remove".length)
                    .trim()
                    .replace(/\s+--preserve$/, "");
                if (!target || target === "--preserve") {
                    ctx.ui.notify("Usage: /worktree remove <path|branch|workspace-id> [--preserve]", "warning");
                    return;
                }
                const result = await removeContainedWorktree({
                    ...cleanupInput(ctx),
                    target,
                    preserve,
                });
                ctx.ui.notify(result.message, result.status === "removed" || result.status === "already-removed"
                    ? "info"
                    : "warning");
                return;
            }
            const branch = parts.shift();
            if (!branch || branch === "list") {
                ctx.ui.notify(parentSession
                    ? "Usage: /worktree <name> [task] | /worktree list | /worktree remove <target> [--preserve]"
                    : "Usage: /worktree <name> [task] | /worktree list", "warning");
                return;
            }
            // A handoff continues this conversation at the same depth, so only an
            // unknown depth refuses it.
            const depthRefusal = delegationDepthRefusal(Number.POSITIVE_INFINITY);
            if (depthRefusal) {
                ctx.ui.notify(depthRefusal.message, "error");
                return;
            }
            if (!runtime.session.availability().available) {
                ctx.ui.notify(runtime.session.availability().setupHint, "error");
                return;
            }
            try {
                await ctx.waitForIdle();
                const sessionFile = ctx.sessionManager.getSessionFile();
                const leafId = ctx.sessionManager.getLeafId();
                if (!sessionFile || !leafId) {
                    throw new Error("Start pi with a completed persistent session before handing off");
                }
                if (!ctx.model)
                    throw new Error("No parent model is selected");
                const thinking = pi.getThinkingLevel();
                if (!isThinkingLevel(thinking)) {
                    throw new Error(`Unsupported parent thinking level: ${thinking}`);
                }
                const task = parts.join(" ") || "Continue the current work in the new worktree.";
                const runtimePlan = resolveRuntimePlan({}, {}, {
                    provider: ctx.model.provider,
                    modelId: ctx.model.id,
                    thinking,
                }, sessionModelRegistry(ctx));
                const result = await runtime.session.handoffWorktree({
                    name: `wt: ${branch}`,
                    task,
                    branch,
                    leafId,
                    runtimePlan,
                    snapshot: {
                        parent: {
                            cwd: ctx.cwd,
                            invocationCwd: process.cwd(),
                            sessionFile,
                            sessionId: ctx.sessionManager.getSessionId(),
                            sessionDir: ctx.sessionManager.getSessionDir(),
                            agentDir: getAgentConfigDir(),
                        },
                        paneConfig,
                        modelRegistry: sessionModelRegistry(ctx),
                    },
                });
                const worktree = result.record.worktree;
                if (!worktree) {
                    throw new Error("Worktree handoff did not return worktree metadata");
                }
                const path = encodeHostValue(worktree.path, HOST_PATH_CHARS);
                ctx.ui.notify((result.focusError
                    ? `Worktree launched, but workspace focus failed: ${errorText(result.focusError)}\nWorktree: ${path}`
                    : `Worktree launched in ${path} (workspace ${encodeHostValue(worktree.workspaceId)}).`) +
                    launchDiagnosticsText(worktree.diagnostics, "\n", ""), result.focusError || worktree.diagnostics?.length
                    ? "warning"
                    : "info");
            }
            catch (error) {
                ctx.ui.notify(`Worktree launch failed: ${errorText(error instanceof Error ? error.message : String(error))}`, "error");
            }
        },
    });
}
//# sourceMappingURL=worktree-tools.js.map