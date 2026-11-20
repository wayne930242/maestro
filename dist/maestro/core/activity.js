import { isString } from "./config/type-guards.js";
const KNOWN_SCOPES = new Set([
    "agent",
    "turn",
    "provider",
    "streaming",
    "tool",
]);
export function isSubagentActivityScope(value) {
    return isString(value) && KNOWN_SCOPES.has(value);
}
// pi-herdr-agents extension
export function projectActivity(state) {
    return state === undefined
        ? { ok: false, reason: "missing" }
        : { ok: true, activity: state };
}
//# sourceMappingURL=activity.js.map