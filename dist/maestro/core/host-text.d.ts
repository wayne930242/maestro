/**
 * Host text for parent-facing sinks. Three policies, never mixed:
 * - display values in a host line are encoded and bounded (`encodeHostValue`);
 * - executable command arguments are serialized losslessly or omitted
 *   (`jsonArgument`, `shellArgument`), never encoded or abbreviated;
 * - child text in a terminal view is split on every line separator and its
 *   controls are shown as escapes before any prefix (`displayLines`).
 */
/** A literal report delimiter in any case, opening or closing. */
export declare const REPORT_DELIMITER: RegExp;
/** Default bound for one variable value inside a host line. */
export declare const HOST_VALUE_CHARS = 200;
/** Bound for a path or a short diagnostic. */
export declare const HOST_PATH_CHARS = 1000;
/** Bound for an error relayed from a child or a tool. */
export declare const HOST_ERROR_CHARS = 4000;
/** Bound one value by replacing its middle with `marker`. */
export declare function abbreviateMiddle(value: string, maxChars: number, marker: string): string;
/**
 * The encoding policy for any child-, transcript- or environment-influenced
 * value shown in a host line: JSON string escaping (so `\n`, `"` and `\` stay
 * visible as escapes), every other control, separator or bidi control as
 * `\uXXXX`, report delimiters neutralized, and a bounded length. The result is
 * always one line. Callers keep the original value in structured details.
 */
export declare function encodeHostValue(value: string, maxChars?: number): string;
/** Host-authored text forced onto one line: controls become visible escapes. */
export declare function oneLine(text: string): string;
/**
 * A lossless JSON string literal for an executable argument: `JSON.parse`
 * returns `value` exactly. It is always one line and never contains a report
 * delimiter, because separators, bidi controls and `<` are `\uXXXX` escapes.
 */
export declare function jsonArgument(value: string): string;
/**
 * A shell word that a POSIX shell reads back as exactly `value`, or undefined
 * when no one-line form is safe to show: a line break or other control, or a
 * literal report delimiter, which shell quoting would keep verbatim and so
 * forge a second envelope tag in the parent message.
 */
export declare function shellArgument(value: string): string | undefined;
/**
 * Child text for a terminal view: one entry per displayed line, split on CR,
 * LF, CRLF, NEL, VT, FF and U+2028/U+2029, with every remaining control
 * (ESC, CSI, bidi controls) shown as `\uXXXX`. Tabs stay; the renderer
 * expands them.
 */
export declare function displayLines(text: string): string[];
//# sourceMappingURL=host-text.d.ts.map