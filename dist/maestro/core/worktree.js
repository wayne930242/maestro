export function isWorktreeManifest(value) {
    return (value.version === 1 &&
        value.kind === "worktree-run" &&
        value.owner === "pi-herdr-subagents");
}
export function mergeWorktreeManifest(existing, value, updatedAt) {
    return {
        ...existing,
        ...value,
        version: 1,
        kind: "worktree-run",
        owner: "pi-herdr-subagents",
        updatedAt,
    };
}
export function worktreeResultState(exitCode, needsHelp) {
    return needsHelp
        ? "needs_help"
        : exitCode === 0
            ? "ready_for_review"
            : "failed";
}
//# sourceMappingURL=worktree.js.map