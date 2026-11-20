import { getAgentDir, getShellConfig, SettingsManager, } from "@earendil-works/pi-coding-agent";
import { isAbsolute, resolve, win32 } from "node:path";
/** True when this Pi gates project-local settings behind a trust decision. */
export function piHasProjectTrustGating() {
    return "isProjectTrusted" in SettingsManager.prototype;
}
/**
 * Whether the launching session trusts its project. A context that reports its
 * decision (`ctx.isProjectTrusted`, Pi 0.79.1 and later) is believed. A context
 * that does not is untrusted when this Pi still gates project settings (0.79.0
 * has the gate but no accessor), and trusted only when Pi has no trust concept
 * at all (0.74 to 0.78), where it loads project settings unconditionally.
 */
export function resolveProjectTrusted(reported, hasTrustGating = piHasProjectTrustGating()) {
    return reported ?? !hasTrustGating;
}
export const piScriptShellDeps = {
    // `projectTrusted` is ignored by Pi releases without trust gating (0.74 to
    // 0.78), which also load project settings unconditionally for the parent.
    readShellPath: ({ cwd, projectTrusted }) => SettingsManager.create(cwd, getAgentDir(), {
        projectTrusted,
    }).getShellPath(),
    resolveShell: getShellConfig,
    baseDir: () => process.cwd(),
};
/**
 * Resolve the bash that runs launch scripts the way Pi resolves it for its own
 * bash tool: the `shellPath` setting (project settings only when the session
 * trusts the project), then Git Bash, then bash on PATH, made absolute against
 * the directory Pi resolves against. Pi's own error
 * (missing custom path, no bash installed) propagates unchanged.
 */
export function createPiScriptShellResolver(context, deps = piScriptShellDeps) {
    return () => {
        const shell = deps.resolveShell(deps.readShellPath(context)).shell;
        // Pi validates a relative path against its own working directory; the
        // pane starts elsewhere, so type the path that Pi checked.
        return win32.isAbsolute(shell) || isAbsolute(shell)
            ? shell
            : resolve(deps.baseDir(), shell);
    };
}
//# sourceMappingURL=script-shell.js.map