import { isNonEmptyString } from "./config/type-guards.js";
const openedPrimaryWorkspacesKey = Symbol.for("pi-herdr-agents:opened-primary-workspaces");
function store() {
    // SAFETY: this extension alone writes this process-local symbol.
    const globalStore = globalThis;
    return (globalStore[openedPrimaryWorkspacesKey] ??= { claims: [] });
}
export function isCompletePrimaryWorkspaceClaim(value) {
    return (isNonEmptyString(value.workspaceId) &&
        isNonEmptyString(value.repoKey) &&
        isNonEmptyString(value.terminalId) &&
        isNonEmptyString(value.checkoutPath));
}
function sameClaim(left, right) {
    return (left.workspaceId === right.workspaceId &&
        left.repoKey === right.repoKey &&
        left.terminalId === right.terminalId &&
        left.checkoutPath === right.checkoutPath);
}
export function rememberOpenedPrimaryWorkspace(claim) {
    if (!isCompletePrimaryWorkspaceClaim(claim))
        return;
    const claims = store().claims;
    if (claims.some((existing) => sameClaim(existing, claim)))
        return;
    claims.push({
        workspaceId: claim.workspaceId,
        repoKey: claim.repoKey,
        terminalId: claim.terminalId,
        checkoutPath: claim.checkoutPath,
    });
}
export function openedPrimaryWorkspaceClaims() {
    return store()
        .claims.filter(isCompletePrimaryWorkspaceClaim)
        .map((claim) => ({ ...claim }));
}
export function forgetOpenedPrimaryWorkspaceClaims(released) {
    if (!released.length)
        return;
    const claims = store().claims;
    store().claims = claims.filter((claim) => !released.some((entry) => entry.workspaceId === claim.workspaceId &&
        entry.repoKey === claim.repoKey &&
        entry.terminalId === claim.terminalId));
}
export function clearOpenedPrimaryWorkspaceClaims() {
    store().claims = [];
}
//# sourceMappingURL=opened-primary-workspace.js.map