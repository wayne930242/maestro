/**
 * Callable Pi composition entry (`@nubl/maestro/pi/extension`). The default
 * export is `createPiExtension` itself: a host wrapper calls it with explicit
 * host options once per Pi load. It is not a zero-config extension, so a host
 * never lists this module as a Pi extension path.
 */
export { createPiExtension, createPiExtension as default, } from "../../pi-extension/subagents/extension.js";
//# sourceMappingURL=extension.js.map