/**
 * Callable Pi composition entry (`@nubl/maestro/pi/extension`). The default
 * export is `createPiExtension` itself: a host wrapper calls it with explicit
 * host options once per Pi load. It is not a zero-config extension, so a host
 * never lists this module as a Pi extension path.
 */
export { createPiExtension, createPiExtension as default, type PiHostOptions, } from "../../pi-extension/subagents/extension.ts";
export type { PiPresentationHooks, PiToolRenderers, } from "../../pi-extension/subagents/presentation-hooks.ts";
export type { HostSurfaceBinding } from "../runtime/host-surface-binding.ts";
//# sourceMappingURL=extension.d.ts.map