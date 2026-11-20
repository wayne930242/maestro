/**
 * Routine host tools register with this exposure. They are declared from the
 * first request: a `deferred` tool that `tool_search` loads mid-session makes
 * Pi rebuild the system prompt, which breaks the provider's prompt cache.
 */
export const ROUTINE_TOOL_EXPOSURE = "direct";
/** The exposure whose tools {@link trackDeferredTools} keeps reachable. */
const DEFERRED_EXPOSURE = "deferred";
const TOOL_SEARCH_NAME = "tool_search";
/** The path Pi gives tools registered by its built-in tool-search extension. */
const TOOL_SEARCH_SOURCE_PATH = "builtin:tool-search";
/**
 * Whether a tool is Pi's built-in `tool_search`. Judged by the public
 * provenance Pi reports, so another extension's tool of the same name never
 * counts, and no schema object is compared across package copies.
 */
export function isNativeToolSearch(tool) {
    return (tool.name === TOOL_SEARCH_NAME &&
        tool.sourceInfo?.source === "builtin" &&
        tool.sourceInfo.path === TOOL_SEARCH_SOURCE_PATH &&
        (tool.exposure === "model-only" || tool.exposure === "direct"));
}
/**
 * Whether the user's `defaultTools` setting removes `tool_search` with
 * `-tool_search`. A setting that never names it leaves the search to the host.
 */
function isSearchTurnedOff(pi) {
    return (pi.getSettings().defaultTools ?? []).includes(`-${TOOL_SEARCH_NAME}`);
}
/**
 * Track the deferred tools registered through the returned API. Ownership is
 * the registered parameter schema object, which only this load holds, so a
 * same-named tool from another extension is never activated.
 */
export function trackDeferredTools(pi) {
    const owned = new Map();
    const registerTool = (tool) => {
        if (tool.exposure === DEFERRED_EXPOSURE)
            owned.set(tool.name, tool.parameters);
        pi.registerTool(tool);
    };
    // SAFETY: the prototype is the real API, so every other member resolves to
    // it unchanged; only registerTool is replaced.
    const api = Object.assign(Object.create(pi), { registerTool });
    return {
        api,
        ensureReachable() {
            const tools = pi.getAllTools();
            const routine = tools
                .filter((tool) => owned.get(tool.name) === tool.parameters)
                .map((tool) => tool.name);
            if (routine.length === 0)
                return "none";
            const search = tools.find(isNativeToolSearch);
            if (search && !isSearchTurnedOff(pi)) {
                const active = pi.getActiveTools();
                if (!active.includes(search.name))
                    pi.setActiveTools([...active, search.name]);
                if (pi.getActiveTools().includes(search.name))
                    return "search";
            }
            const active = pi.getActiveTools();
            const missing = routine.filter((name) => !active.includes(name));
            if (missing.length > 0)
                pi.setActiveTools([...active, ...missing]);
            return "eager";
        },
    };
}
//# sourceMappingURL=deferred-tools.js.map