import { buildTaskModelBrief, buildTaskModelInitPrompt, collectApprovalOffers, DIRECT_WRITER_DESTINATION, openApprovalOffer, selectApprovalRoute, } from "../core/config/task-model-init.js";
import { projectTaskModelRegistry } from "../adapters/pi/task-model-init.js";
/** Listeners share the brief; freezing it keeps the prompt equal to what they saw. */
function deepFreeze(value) {
    if (value == null || Object(value) !== value)
        return value;
    // SAFETY: Object(value) === value holds only for objects and functions.
    for (const item of Object.values(value))
        deepFreeze(item);
    return Object.freeze(value);
}
function isNonEmpty(values) {
    return values.length > 0;
}
/**
 * Capture one brief, pick where its proposal goes, and submit the prompt. It
 * runs synchronously, so nothing can change between selection and submission.
 * An opened offer that is not submitted is cancelled before this returns.
 */
export function startTaskModelInit(input) {
    const notStarted = (reason) => ({
        kind: "not-started",
        reason,
    });
    let snapshot;
    try {
        snapshot = input.readConfig();
    }
    catch (error) {
        return notStarted(error instanceof Error ? error.message : String(error));
    }
    const { models } = input.projectActiveRegistry(projectTaskModelRegistry);
    if (!isNonEmpty(models))
        return notStarted("the active registry has no authenticated models, so there is nothing to rank. Configure a provider, then run /subagents-init again");
    const brief = deepFreeze(buildTaskModelBrief({
        models,
        current: snapshot.config,
        configRevision: snapshot.revision,
        preferences: input.preferences,
    }));
    const route = selectApprovalRoute(collectApprovalOffers((offer) => input.emitApprovalRequest(brief, offer)));
    let destination;
    let cancel = () => undefined;
    switch (route.kind) {
        case "direct":
            destination = DIRECT_WRITER_DESTINATION;
            break;
        case "refused":
            return notStarted(route.reason);
        case "offer": {
            const opened = openApprovalOffer(route.offer);
            if (opened.kind === "blocked")
                return notStarted(opened.reason);
            destination = opened.destination;
            cancel = opened.cancel;
            break;
        }
        default: {
            const _exhaustive = route;
            return _exhaustive;
        }
    }
    const cancelled = (reason) => {
        const problem = cancel();
        return notStarted(problem ? `${reason}; ${problem}` : reason);
    };
    input.activateTool?.(destination.toolName);
    if (!input.isToolActive(destination.toolName))
        return cancelled(`${destination.toolName} is not an active tool`);
    try {
        input.submit(buildTaskModelInitPrompt(brief, destination));
    }
    catch (error) {
        return cancelled(`Pi did not accept the init prompt (${error instanceof Error ? error.message : String(error)})`);
    }
    return { kind: "started", destination: destination.toolName };
}
//# sourceMappingURL=task-model-init.js.map