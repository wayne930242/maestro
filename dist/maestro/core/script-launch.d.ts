/**
 * Resolves the absolute path of the bash that runs a launch script. Returns
 * `undefined` when the host has no usable bash. It is only called on Windows,
 * and only once the pane's shell is known.
 */
export type ScriptShellResolver = () => string | undefined;
/** The shells a Windows Herdr pane can run that this host knows how to address. */
export type PaneShell = "powershell" | "cmd" | "posix";
/** True for the WSL launcher (`<drive>:\Windows\System32|Sysnative\bash.exe`). */
export declare function isWslBashLauncher(path: string): boolean;
/**
 * Quote a value as a PowerShell single-quoted literal. PowerShell treats the
 * typographic single quotes as quote characters too, so each one is doubled.
 */
export declare function powerShellQuote(value: string): string;
/**
 * Classify a Windows pane shell from the `name` (or `argv0`) Herdr reports for
 * the pane's shell process: `powershell.exe`, `pwsh.exe`, `cmd.exe`,
 * `bash.exe` (Git Bash) or `sh.exe`. Anything else is unknown.
 */
export declare function classifyPaneShell(name: string | undefined): PaneShell | undefined;
/**
 * The line typed into a pane to run a launch script.
 *
 * Off Windows the pane's own `bash` runs it. On Windows the pane's shell is
 * configurable (`terminal.default_shell`), and a bare `bash` can resolve to the
 * WSL launcher, which runs the script inside WSL. So when the pane shell is
 * known the script runs through an absolute bash path, spelled for that shell:
 *
 * - PowerShell: `& '<bash>' '<script>'`
 * - cmd: `"<bash>" "<script>"`
 * - Git Bash / sh: `'<bash>' '<script>'`
 *
 * An unknown shell, or no process info, keeps the bare `bash '<script>'` line
 * as before, and the resolver is not called. A Git Bash / sh pane also keeps it
 * when no usable bash resolves (none, an error, or the WSL launcher), since its
 * own `bash` is the right one. In a PowerShell or cmd pane the bare line would
 * hit WSL or nothing, so a missing bash, the WSL launcher, or a path cmd would
 * expand fails before anything is typed.
 */
export declare function buildScriptLaunchCommand(options: {
    scriptPath: string;
    platform: NodeJS.Platform;
    paneShell?: PaneShell | undefined;
    resolveShell?: ScriptShellResolver | undefined;
}): string;
//# sourceMappingURL=script-launch.d.ts.map