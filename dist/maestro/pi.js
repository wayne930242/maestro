/**
 * Pi composition facade (`@nubl/maestro/pi`). A host calls `createPiExtension`
 * once per Pi load with its HostSurfaceBinding and PiPresentationHooks; the
 * package registers nothing by itself and discovers no provider.
 */
export { createPiExtension, } from "../pi-extension/subagents/extension.js";
export { maestroBuildInfo } from "./build-info.js";
//# sourceMappingURL=pi.js.map