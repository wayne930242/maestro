import type { ExtensionAPI, ToolInfo } from "@earendil-works/pi-coding-agent";
/**
 * Routine host tools register with this exposure. They are declared from the
 * first request: a `deferred` tool that `tool_search` loads mid-session makes
 * Pi rebuild the system prompt, which breaks the provider's prompt cache.
 */
export declare const ROUTINE_TOOL_EXPOSURE: "direct";
/** The tool metadata {@link isNativeToolSearch} reads. */
export type ToolSearchCandidate = Pick<ToolInfo, "name" | "exposure"> & {
    sourceInfo?: Partial<ToolInfo["sourceInfo"]>;
};
/**
 * Whether a tool is Pi's built-in `tool_search`. Judged by the public
 * provenance Pi reports, so another extension's tool of the same name never
 * counts, and no schema object is compared across package copies.
 */
export declare function isNativeToolSearch(tool: ToolSearchCandidate): boolean;
/** How {@link DeferredTools.ensureReachable} made the routine tools reachable. */
export type DeferredReach = 
/** Pi's `tool_search` is active and loads the routine tools on demand. */
"search"
/** No usable native search, or the user turned it off: the permitted routine tools are active now. */
 | "eager"
/** Pi kept none of this load's routine tools (allowlist, exclusion, or deny list). */
 | "none";
export interface DeferredTools {
    /** Registration API that records which deferred tools this load owns. */
    api: ExtensionAPI;
    /**
     * Make this load's routine tools reachable once every extension has
     * registered: activate Pi's `tool_search`, or, when it is missing, filtered
     * out, turned off by `defaultTools`, or not Pi's own, activate the routine
     * tools Pi kept. Other active and restored tools stay active; tools Pi
     * filtered out stay unreachable.
     */
    ensureReachable(): DeferredReach;
}
/**
 * Track the deferred tools registered through the returned API. Ownership is
 * the registered parameter schema object, which only this load holds, so a
 * same-named tool from another extension is never activated.
 */
export declare function trackDeferredTools(pi: ExtensionAPI): DeferredTools;
//# sourceMappingURL=deferred-tools.d.ts.map