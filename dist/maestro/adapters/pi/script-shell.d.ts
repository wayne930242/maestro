import type { ScriptShellResolver } from "../../core/script-launch.ts";
/**
 * Which settings the launch reads `shellPath` from: the launching session's
 * directory and its project-trust decision, so an untrusted project cannot
 * choose the executable and the host reads what the parent's bash tool reads.
 */
export interface PiScriptShellContext {
    cwd: string;
    projectTrusted: boolean;
}
export interface PiScriptShellDeps {
    /** Pi's `shellPath` setting, as the bash tool reads it for this session. */
    readShellPath: (context: PiScriptShellContext) => string | undefined;
    /** Pi's bash-tool shell resolution; throws when no bash is found. */
    resolveShell: (shellPath?: string) => {
        shell: string;
    };
    /** Base Pi's own bash tool resolves a relative `shellPath` against. */
    baseDir: () => string;
}
/** True when this Pi gates project-local settings behind a trust decision. */
export declare function piHasProjectTrustGating(): boolean;
/**
 * Whether the launching session trusts its project. A context that reports its
 * decision (`ctx.isProjectTrusted`, Pi 0.79.1 and later) is believed. A context
 * that does not is untrusted when this Pi still gates project settings (0.79.0
 * has the gate but no accessor), and trusted only when Pi has no trust concept
 * at all (0.74 to 0.78), where it loads project settings unconditionally.
 */
export declare function resolveProjectTrusted(reported: boolean | undefined, hasTrustGating?: boolean): boolean;
export declare const piScriptShellDeps: PiScriptShellDeps;
/**
 * Resolve the bash that runs launch scripts the way Pi resolves it for its own
 * bash tool: the `shellPath` setting (project settings only when the session
 * trusts the project), then Git Bash, then bash on PATH, made absolute against
 * the directory Pi resolves against. Pi's own error
 * (missing custom path, no bash installed) propagates unchanged.
 */
export declare function createPiScriptShellResolver(context: PiScriptShellContext, deps?: PiScriptShellDeps): ScriptShellResolver;
//# sourceMappingURL=script-shell.d.ts.map