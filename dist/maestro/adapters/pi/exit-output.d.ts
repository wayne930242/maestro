/**
 * The last lines a child Pi printed when it exited before its session started
 * (#149). Pi writes a startup failure, such as an extension that fails to
 * load, to stderr, which is the child's terminal; the host reads that terminal
 * once and relays a bounded, redacted tail so a failure carries its reason.
 */
/** Terminal lines read once after an early exit. */
export declare const EXIT_OUTPUT_SCREEN_LINES = 40;
/** Most lines relayed. */
export declare const EXIT_OUTPUT_MAX_LINES = 12;
/** Most characters per relayed line. */
export declare const EXIT_OUTPUT_LINE_CHARS = 300;
/** Most characters relayed in total. */
export declare const EXIT_OUTPUT_MAX_CHARS = 2000;
/** Longest wait for that read. The host's own readers time out later (5-10s). */
export declare const EXIT_OUTPUT_READ_TIMEOUT_MS = 3000;
/** Mask credential-shaped substrings of one or more lines. */
export declare function redactSecrets(text: string): string;
/**
 * A terminal read bounded by `ms`: undefined when it fails or does not settle
 * in time, so a stuck read never holds back the failure it would explain.
 */
export declare function readWithin(read: () => string | Promise<string>, ms: number): Promise<string | undefined>;
/**
 * The child's output from a terminal tail: the lines after the launch line
 * (the last line naming `launchScriptFile`, when present) and before the exit
 * marker, cleaned, redacted and bounded. Undefined when nothing is left.
 */
export declare function extractExitOutput(screen: string, launchScriptFile?: string): string | undefined;
//# sourceMappingURL=exit-output.d.ts.map