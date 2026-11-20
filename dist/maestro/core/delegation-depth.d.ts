/**
 * Host-enforced delegation depth. A top-level parent session has depth 0 and
 * every launch exports `PI_SUBAGENT_DEPTH=<parent depth + 1>` to its child.
 * The raw environment string is parsed once, here, into a typed value.
 */
export declare const DELEGATION_DEPTH_ENV = "PI_SUBAGENT_DEPTH";
/** Parent 0, children 1, grandchildren 2, great-grandchildren 3. */
export declare const DEFAULT_MAX_DELEGATION_DEPTH = 3;
export type DelegationDepth = {
    kind: "known";
    depth: number;
} | {
    kind: "unknown";
    raw: string;
};
/**
 * An absent variable means a top-level session (depth 0). A present value must
 * be a canonical non-negative decimal integer; anything else is unknown and is
 * never treated as 0, so a corrupted value cannot reset the count.
 */
export declare function parseDelegationDepth(raw: string | undefined): DelegationDepth;
export type DelegationDecision = {
    allowed: true;
    childDepth: number;
} | {
    allowed: false;
    reason: "unknown-depth" | "max-depth";
    message: string;
};
/** Decide whether a session at `parent` depth may launch one more child. */
export declare function decideDelegation(parent: DelegationDepth, maxDepth: number): DelegationDecision;
/**
 * The depth to export from a session with this environment: one more for a
 * child, the same for a handoff that continues this conversation. Throws on an
 * unknown parent depth rather than guessing.
 */
export declare function childDelegationDepth(rawParentDepth: string | undefined, launch?: "child" | "handoff"): number;
//# sourceMappingURL=delegation-depth.d.ts.map