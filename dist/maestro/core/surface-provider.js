/** A started mutating request has no proven outcome. Never retry it. */
export class AcquisitionUncertainError extends Error {
    code = "PIHA_ACQUISITION_UNCERTAIN";
    uncertainty;
    constructor(message, uncertainty, options) {
        super(message, options);
        this.name = "AcquisitionUncertainError";
        this.uncertainty = uncertainty;
    }
}
/* oxlint-disable anti-slop/no-unknown-parameters, anti-slop/no-runtime-typeof, anti-slop/no-unsafe-dictionary-type -- This harness-neutral error boundary validates unknown cross-load values without an SDK/schema dependency. */
function isAcquisitionRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
/** Structural so errors from an earlier extension load remain recognizable. */
export function isAcquisitionUncertainError(error) {
    if (!isAcquisitionRecord(error) ||
        error.code !== "PIHA_ACQUISITION_UNCERTAIN" ||
        typeof error.name !== "string" ||
        typeof error.message !== "string" ||
        (error.stack !== undefined && typeof error.stack !== "string") ||
        typeof error.toString !== "function")
        return false;
    const value = error.uncertainty;
    if (!isAcquisitionRecord(value))
        return false;
    switch (value.kind) {
        case "surface-create":
            return ((value.placement === "tab" || value.placement === "split") &&
                (value.workspaceId === undefined ||
                    typeof value.workspaceId === "string") &&
                (value.anchorSurfaceId === undefined ||
                    typeof value.anchorSurfaceId === "string") &&
                (value.observedSurfaceId === undefined ||
                    typeof value.observedSurfaceId === "string"));
        case "worktree-create": {
            if (typeof value.sourceCwd !== "string" ||
                typeof value.branch !== "string")
                return false;
            const recovered = value.recovered;
            return (recovered === undefined ||
                (isAcquisitionRecord(recovered) &&
                    typeof recovered.path === "string" &&
                    typeof recovered.branch === "string" &&
                    (recovered.workspaceId === undefined ||
                        typeof recovered.workspaceId === "string") &&
                    (recovered.paneId === undefined ||
                        typeof recovered.paneId === "string")));
        }
        case "command-dispatch":
            return typeof value.surfaceId === "string";
        case "execution-start":
            return ((value.observedSurfaceId === undefined ||
                (typeof value.observedSurfaceId === "string" &&
                    /^t[0-9a-z]+$/.test(value.observedSurfaceId))) &&
                (value.acquiredSurfaceId === undefined ||
                    (typeof value.acquiredSurfaceId === "string" &&
                        value.acquiredSurfaceId === value.observedSurfaceId)));
        default:
            return false;
    }
}
export class WorktreeProvisioningError extends Error {
    recoveredWorktree;
    constructor(message, recoveredWorktree) {
        super(message);
        this.name = "WorktreeProvisioningError";
        this.recoveredWorktree = recoveredWorktree;
    }
}
//# sourceMappingURL=surface-provider.js.map