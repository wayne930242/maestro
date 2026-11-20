/**
 * Child protocol facade (`@nubl/maestro/pi/child`). The default export is the
 * protocol-only child extension, the same instance the emitted launch entry
 * (`DEFAULT_CHILD_ENTRY_PATH`) loads. A terminal host's child wrapper calls
 * `createChildExtension(renderWidget)` with its presentation hook instead.
 */
export { createChildExtension, default, } from "../adapters/pi/child/protocol.js";
//# sourceMappingURL=child.js.map