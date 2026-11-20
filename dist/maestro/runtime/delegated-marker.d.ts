/** Structural transport results; the terminal host supplies socket callbacks. */
export type PaneTokenOutcome = "answered" | "pane-missing" | "failed";
export type PaneAgentSessionRead = {
    kind: "session";
    path?: string;
} | {
    kind: "none";
} | {
    kind: "pane-missing";
} | {
    kind: "failed";
    reason: string;
};
/** The pane token the Pi Herdr Agents Sidebar plugin reads. */
export declare const DELEGATED_MARKER_TOKEN = "piha_delegated_v1";
/** Recently classified as a delegated child; never proof of a live occupant. */
export declare const DELEGATED_MARKER_VALUE = "live";
/** One stable source: a pane accepts sequenced reports from at most 32. */
export declare const DELEGATED_MARKER_SOURCE = "pi-herdr-agents";
/** Bounds a leftover marker after the last write Herdr applied, not liveness. */
export declare const DELEGATED_MARKER_TTL_MS = 15000;
/**
 * Renewal rides on supervision observations: the 4.8s reconciliation, or
 * 1s fallback polling. Both leave several renewals inside one TTL.
 */
export declare const DELEGATED_MARKER_RENEW_MS = 4000;
/**
 * Consecutive failed renewal reads or writes before a live marker stops; its
 * TTL ends it. Discovery instead retries until its window ends.
 */
export declare const DELEGATED_MARKER_MAX_FAILURES = 3;
/** How long a new marker waits for Herdr to report the child's session. */
export declare const DELEGATED_MARKER_DISCOVERY_MS = 15000;
export declare const DELEGATED_MARKER_DISCOVERY_POLL_MS = 250;
export type MarkerWriter = (write: {
    paneId: string;
    seq: number;
    live: boolean;
}) => Promise<PaneTokenOutcome>;
/** The agent session Herdr currently stores for a pane. */
export type MarkerSessionReader = (paneId: string) => Promise<PaneAgentSessionRead>;
type MarkerState = {
    kind: "pending";
} | {
    kind: "live";
    lastSentAt: number;
} | {
    kind: "retired";
};
/**
 * This parent process's marker writes. Every pane shares one sequence that
 * starts at wall-clock microseconds, so a restarted parent still outranks
 * its predecessor's writes unless the clock moved backwards.
 */
export declare class DelegatedMarkers {
    readonly write: MarkerWriter;
    readonly readSession: MarkerSessionReader;
    readonly now: () => number;
    readonly sleep: (ms: number) => Promise<void>;
    private lastSeq;
    constructor(options: {
        write: MarkerWriter;
        readSession: MarkerSessionReader;
        now?: () => number;
        sleep?: (ms: number) => Promise<void>;
    });
    /**
     * A marker for one launched child. It publishes only once Herdr reports
     * the child's own session file for its pane; until then it never writes.
     */
    attach(child: {
        surface: string;
        sessionFile: string;
    }): DelegatedMarker;
    nextSeq(): number;
}
/**
 * One child's marker. Writes are serialized: at most one renewal is queued or
 * in flight, followed by at most one clear. Renewal continues only while
 * Herdr reports the child's session file for the pane. Herdr drops that
 * session when the child exits or another agent takes the pane, so a later
 * occupant never inherits the marker's renewal. With Herdr 0.9.4 or later a
 * suspended child (Ctrl-Z) keeps its session, also after it resumes with fg,
 * until it exits, so its marker stays live meanwhile.
 */
export declare class DelegatedMarker {
    readonly paneId: string;
    readonly sessionFile: string;
    private readonly owner;
    private state;
    private sentLive;
    private renewalQueued;
    private failures;
    private queue;
    private readonly discovery;
    constructor(owner: DelegatedMarkers, paneId: string, sessionFile: string);
    get kind(): MarkerState["kind"];
    /** Resolves once discovery ends and every write queued by then settles. */
    settled(): Promise<void>;
    /** Called on each supervision observation; renews at most every 4s. */
    renew(): void;
    /** Idempotent. Clears the token if any live write may have reached Herdr. */
    retire(): void;
    private discover;
    private renewal;
    private owns;
    private read;
    private fail;
    private send;
}
export {};
//# sourceMappingURL=delegated-marker.d.ts.map