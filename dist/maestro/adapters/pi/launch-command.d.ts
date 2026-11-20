/**
 * The protocol-only child entry beside this module: `entry.js` when emitted,
 * `entry.ts` when run from source. A terminal host passes its own wrapper.
 */
export declare const DEFAULT_CHILD_ENTRY_PATH: string;
/**
 * `--models <refs>` for a scoped parent, or nothing when unscoped. Pi reads
 * these as patterns, so this is only a hint for the child's own model
 * cycling; {@link modelScopeAssignment} carries the enforced allowlist.
 */
export declare function modelScopeArgs(modelScope: readonly string[] | undefined): string[];
/**
 * The exact allowlist the child's routing intersects with its own scope. Set
 * on every launch, empty when unscoped, so a value left in the pane's shell
 * never reaches the child.
 */
export declare function modelScopeAssignment(modelScope: readonly string[] | undefined): string;
/**
 * Always set explicitly so a value left in the pane's shell never reaches the
 * child. Throws when this session's own depth is unknown.
 */
export declare function childDepthAssignment(launch?: "child" | "handoff"): string;
export declare function buildSubagentToolAllowlist(tools?: string, autoExit?: boolean, notify?: boolean): string | null;
export declare function timestampForFile(includeMilliseconds?: boolean): string;
export declare function shellComment(value: string): string;
export declare function safeName(name: string): string;
//# sourceMappingURL=launch-command.d.ts.map