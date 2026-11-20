/**
 * The last lines a child Pi printed when it exited before its session started
 * (#149). Pi writes a startup failure, such as an extension that fails to
 * load, to stderr, which is the child's terminal; the host reads that terminal
 * once and relays a bounded, redacted tail so a failure carries its reason.
 */
/** Terminal lines read once after an early exit. */
export const EXIT_OUTPUT_SCREEN_LINES = 40;
/** Most lines relayed. */
export const EXIT_OUTPUT_MAX_LINES = 12;
/** Most characters per relayed line. */
export const EXIT_OUTPUT_LINE_CHARS = 300;
/** Most characters relayed in total. */
export const EXIT_OUTPUT_MAX_CHARS = 2_000;
/** Longest wait for that read. The host's own readers time out later (5-10s). */
export const EXIT_OUTPUT_READ_TIMEOUT_MS = 3_000;
const TERMINAL_SENTINEL = /__SUBAGENT_DONE_\d+__/;
// CSI and OSC escape sequences; then, per line, any remaining control.
const ANSI_ESCAPE = 
// oxlint-disable-next-line no-control-regex -- terminal escapes start with ESC.
/\u001b\[[0-?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)|\u001b[@-_]/g;
const CONTROL = /\p{Cc}/gu;
const REDACTED = "[redacted]";
// AWS access key IDs by their documented unique-ID prefixes: AKIA long-term,
// ASIA temporary (STS), and the other IAM resource prefixes.
const AWS_KEY_ID = /\b(?:A3T[A-Z0-9]|AKIA|ASIA|ABIA|ACCA|AGPA|AIDA|AIPA|ANPA|ANVA|APKA|AROA|ASCA)[A-Z0-9]{16}\b/g;
const SECRET_RULES = [
    // user:password@ in a URL
    { pattern: /\b[a-z][a-z0-9+.-]*:\/\/([^\s/@:]+:[^\s/@]+)(?=@)/gi },
    // key, token, signature or password query parameters
    {
        pattern: /[?&][^\s=&#]*(?:key|token|sig|signature|secret|password|auth)[^\s=&#]*=([^\s&#"']+)/gi,
    },
    // Authorization: <scheme> <credential>, in any case
    {
        pattern: /\bauthorization["']?\s*[:=]\s*["']?(?:(?:bearer|basic|digest|token|negotiate)\s+)?([^\s"',;]+)/gi,
    },
    // Bearer/Basic <credential>
    { pattern: /\b(?:[Bb]earer|BEARER|Basic)\s+([A-Za-z0-9._~+/=-]{8,})/g },
    // NAME=value, "name": "value" and name: value for credential-like names
    {
        pattern: /\b[A-Za-z0-9_.-]*(?:api[_-]?key|apikey|token|secret|passw(?:or)?d|credential)[A-Za-z0-9_.-]*["']?\s*[:=]\s*["']?([^\s"',;]+)/gi,
    },
    // Well-known credential prefixes
    {
        pattern: /\b(?:sk|pk|rk)-[A-Za-z0-9_-]{16,}|\b(?:gh[pousr]_|github_pat_)[A-Za-z0-9_]{20,}|\bglpat-[A-Za-z0-9_-]{20,}|\bxox[abprs]-[A-Za-z0-9-]{10,}|\bAIza[0-9A-Za-z_-]{35}\b/g,
    },
    { pattern: AWS_KEY_ID },
    // A JWT (or JWE) of any length: base64url JSON ("eyJ") and its segments.
    { pattern: /\beyJ[A-Za-z0-9_-]{4,}(?:\.[A-Za-z0-9_-]*)*/g },
    // An AWS secret access key: exactly 40 base64 characters, mixed case with a
    // digit or "+". A path is rarely exactly 40 such characters and never
    // starts the run with "/"; when one does match, it is masked.
    {
        pattern: /(?<![A-Za-z0-9/+])[A-Za-z0-9/+]{40}(?![A-Za-z0-9/+])/g,
        keep: (run) => !run.startsWith("/") &&
            /[A-Z]/.test(run) &&
            /[a-z]/.test(run) &&
            /[0-9+]/.test(run),
    },
    // A long opaque run with both letters and digits: likely a key or token.
    {
        pattern: /[A-Za-z0-9+_=-]{40,}/g,
        keep: (run) => /\d/.test(run) && /[A-Za-z]/.test(run),
    },
];
/** [start, end) ranges of credential-shaped text. */
function secretRanges(text) {
    const ranges = [];
    for (const { pattern, keep } of SECRET_RULES)
        for (const match of text.matchAll(pattern)) {
            if (keep && !keep(match[0]))
                continue;
            const end = match.index + match[0].length;
            const secret = match[1] ?? match[0];
            if (secret.length > 0)
                ranges.push([end - secret.length, end]);
        }
    return ranges;
}
/**
 * Mask credential-shaped text in terminal rows. Best effort: it errs toward
 * masking. Each row is masked on its own; then rows a terminal wrapped are
 * rejoined and masked again, so a credential split across rows is masked on
 * every row it reaches. A row as wide as the widest row is taken to wrap into
 * the next; a row one character narrower, to wrap on a space the read trimmed.
 */
function redactLines(lines) {
    const masks = lines.map((line) => new Uint8Array(line.length));
    lines.forEach((line, row) => {
        for (const [start, end] of secretRanges(line))
            masks[row].fill(1, start, end);
    });
    const width = Math.max(0, ...lines.map((line) => line.length));
    for (let first = 0, last = 0; first < lines.length; first = ++last) {
        let joined = lines[first];
        const offsets = [0];
        while (last + 1 < lines.length && lines[last].length >= width - 1) {
            joined += lines[last].length === width ? "" : " ";
            offsets.push(joined.length);
            joined += lines[++last];
        }
        if (last === first)
            continue;
        for (const [start, end] of secretRanges(joined))
            for (let row = first; row <= last; row++) {
                const offset = offsets[row - first];
                const from = Math.max(start - offset, 0);
                const to = Math.min(end - offset, lines[row].length);
                if (from < to)
                    masks[row].fill(1, from, to);
            }
    }
    return lines.map((line, row) => {
        let masked = "";
        for (let at = 0; at < line.length; at++)
            if (!masks[row][at])
                masked += line[at];
            else if (at === 0 || !masks[row][at - 1])
                masked += REDACTED;
        return masked;
    });
}
/** Mask credential-shaped substrings of one or more lines. */
export function redactSecrets(text) {
    return redactLines(text.split("\n")).join("\n");
}
/**
 * A terminal read bounded by `ms`: undefined when it fails or does not settle
 * in time, so a stuck read never holds back the failure it would explain.
 */
export async function readWithin(read, ms) {
    let timer;
    try {
        return await Promise.race([
            Promise.resolve().then(read),
            new Promise((resolve) => {
                timer = setTimeout(() => resolve(undefined), ms);
            }),
        ]);
    }
    catch {
        return undefined;
    }
    finally {
        clearTimeout(timer);
    }
}
function clip(line, max) {
    return line.length <= max ? line : `${line.slice(0, max - 1)}…`;
}
/**
 * The child's output from a terminal tail: the lines after the launch line
 * (the last line naming `launchScriptFile`, when present) and before the exit
 * marker, cleaned, redacted and bounded. Undefined when nothing is left.
 */
export function extractExitOutput(screen, launchScriptFile) {
    let lines = screen
        .replace(ANSI_ESCAPE, "")
        .split(/\r?\n|\r/)
        .map((line) => line.replace(/\t/g, " ").replace(CONTROL, "").trimEnd());
    const marker = lines.findLastIndex((line) => TERMINAL_SENTINEL.test(line));
    if (marker !== -1)
        lines = lines.slice(0, marker);
    const launchName = launchScriptFile?.split(/[\\/]/).pop();
    if (launchName) {
        const launch = lines.findLastIndex((line) => line.includes(launchName));
        if (launch !== -1)
            lines = lines.slice(launch + 1);
    }
    // Mask the whole read before taking the tail, so a credential that started
    // on a row above the tail is still recognised.
    const tail = redactLines(lines.filter((line) => line.trim() !== "")).slice(-EXIT_OUTPUT_MAX_LINES);
    const kept = [];
    let chars = 0;
    // Newest lines first, so the character bound drops the oldest.
    for (let index = tail.length - 1; index >= 0; index--) {
        const relayed = clip(tail[index], EXIT_OUTPUT_LINE_CHARS);
        if (chars + relayed.length > EXIT_OUTPUT_MAX_CHARS)
            break;
        chars += relayed.length + 1;
        kept.unshift(relayed);
    }
    return kept.length > 0 ? kept.join("\n") : undefined;
}
//# sourceMappingURL=exit-output.js.map