import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
/**
 * An error whose message is already one encoded host line, such as a cleanup
 * result. The boundary passes its message through instead of encoding twice.
 */
export declare class HostEncodedError extends Error {
}
/** Marks a tool `execute` that passed through {@link withEncodedToolErrors}. */
export declare const ENCODED_TOOL_ERRORS: unique symbol;
/**
 * The extension API every host tool and command registers through. A thrown
 * error reaches the parent as one encoded line, whichever tool or command
 * threw it, with the original kept as `cause`.
 */
export declare function withEncodedToolErrors(pi: ExtensionAPI): ExtensionAPI;
//# sourceMappingURL=tool-boundary.d.ts.map