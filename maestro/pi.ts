/**
 * Pi composition facade (`@nubl/maestro/pi`). A host calls `createPiExtension`
 * once per Pi load with its HostSurfaceBinding and PiPresentationHooks; the
 * package registers nothing by itself and discovers no provider.
 */
export {
	createPiExtension,
	type PiHostOptions,
} from "../pi-extension/subagents/extension.ts";
export type {
	PiPresentationHooks,
	PiToolRenderers,
} from "../pi-extension/subagents/presentation-hooks.ts";
export { type MaestroBuildInfo, maestroBuildInfo } from "./build-info.ts";
export type { HostSurfaceBinding } from "./runtime/host-surface-binding.ts";
