import { encodeHostValue, HOST_ERROR_CHARS, } from "../../maestro/core/host-text.js";
/**
 * An error whose message is already one encoded host line, such as a cleanup
 * result. The boundary passes its message through instead of encoding twice.
 */
export class HostEncodedError extends Error {
}
/** Marks a tool `execute` that passed through {@link withEncodedToolErrors}. */
export const ENCODED_TOOL_ERRORS = Symbol.for("pi-herdr-agents/encoded-tool-errors");
function encodedMessage(message) {
    return encodeHostValue(message, HOST_ERROR_CHARS);
}
/**
 * The extension API every host tool and command registers through. A thrown
 * error reaches the parent as one encoded line, whichever tool or command
 * threw it, with the original kept as `cause`.
 */
export function withEncodedToolErrors(pi) {
    const registerTool = (tool) => {
        const execute = async (...args) => {
            try {
                return await tool.execute(...args);
            }
            catch (error) {
                if (error instanceof HostEncodedError)
                    throw error;
                throw new Error(encodedMessage(error instanceof Error ? error.message : String(error)), { cause: error });
            }
        };
        Object.defineProperty(execute, ENCODED_TOOL_ERRORS, { value: true });
        pi.registerTool({ ...tool, execute });
    };
    const registerCommand = (name, command) => {
        pi.registerCommand(name, {
            ...command,
            async handler(...args) {
                try {
                    return await command.handler(...args);
                }
                catch (error) {
                    if (error instanceof HostEncodedError)
                        throw error;
                    throw new Error(encodedMessage(error instanceof Error ? error.message : String(error)), { cause: error });
                }
            },
        });
    };
    // SAFETY: the prototype is the real API, so every other member resolves to
    // it unchanged; only the two registration methods are replaced.
    const wrapped = Object.create(pi);
    return Object.assign(wrapped, { registerTool, registerCommand });
}
//# sourceMappingURL=tool-boundary.js.map