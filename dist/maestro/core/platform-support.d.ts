/**
 * Host platform scope. On Windows the host supports ordinary subagents on
 * legacy Herdr only. Managed worktrees are refused there because cleanup
 * decides ownership by POSIX uid and finds checkout holders through Linux
 * `/proc` or macOS `lsof`, so a Windows worktree could be created but never
 * safely removed. Herdr Core on Windows is unverified. Every refusal happens
 * before any effect. The platform is a parameter so tests can inject win32.
 */
export declare const MANAGED_WORKTREES_UNSUPPORTED_ON_WINDOWS = "Managed worktrees are not supported on Windows: cleanup cannot verify worktree ownership or open checkouts there. Launch an ordinary subagent without worktree instead.";
export declare const HERDR_CORE_UNSUPPORTED_ON_WINDOWS = "Herdr Core is not supported on Windows. Restart Pi in a legacy Herdr pane with herdr.backend \"legacy\" or \"auto\".";
/** The refusal for any managed-worktree operation on `platform`, if any. */
export declare function managedWorktreeRefusal(platform?: NodeJS.Platform): string | undefined;
/** Throw the managed-worktree refusal for `platform` before any effect. */
export declare function assertManagedWorktreesSupported(platform?: NodeJS.Platform): void;
//# sourceMappingURL=platform-support.d.ts.map