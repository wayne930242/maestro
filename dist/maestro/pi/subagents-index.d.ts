/**
 * Internal-compat counterpart of the upstream terminal entry
 * (`@nubl/maestro/pi/subagents/index`): the same named helpers, and a default
 * export that delegates to the factory. Unlike the terminal entry it creates no
 * extension instance, so it has no `__test__`, widgets or renderers; the host
 * calls `createPiExtension` with its own binding and presentation.
 */
export { cleanupSubagentsForShutdown, createPiExtension, createPiExtension as default, hasWorkingSubagents, selectCompletionApi, shouldAdvanceToFallback, shouldDeliverSubagentCompletion, shouldPreserveSubagentsOnShutdown, } from "../../pi-extension/subagents/extension.ts";
//# sourceMappingURL=subagents-index.d.ts.map