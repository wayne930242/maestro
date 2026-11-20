/**
 * Immutable kernel facts naming one Pi child process for its whole life.
 * Mutable command-line text (Pi rewrites `process.title`) is never identity.
 */
export interface PiProcessIdentity {
    pid: number;
    /**
     * Fixed at fork. Linux: `/proc/<pid>/stat` field 22, clock ticks after boot.
     * macOS: `ps -o lstart` as UTC epoch seconds.
     */
    startTime: string;
    /**
     * Start times are per boot. Linux: `/proc/sys/kernel/random/boot_id`.
     * macOS: `kern.bootsessionuuid`.
     */
    bootId: string;
    /**
     * PIDs are per PID namespace. Linux: the `/proc/self/ns/pid` link target.
     * macOS has none, so every process shares the one fixed namespace name.
     */
    pidNamespace: string;
}
/** One sidecar per session, so a reused run ID can never inherit a record. */
export declare function getSubagentProcessIdentityFile(sessionFile: string): string;
/** The child's self-recorded identity sidecar, bound to one run and session. */
export interface PiProcessIdentityRecord extends PiProcessIdentity {
    version: 1;
    id: string;
    sessionFile: string;
}
export interface ProcessStat {
    /** Single-letter state; Z (zombie) and X (dead) have exited. */
    state: string;
    ppid: number;
    startTime: string;
}
/** This host's kernel process facts; tests inject a fake. */
export interface ProcessIdentityProbe {
    /** The calling process's namespace facts; throws when unreadable or unsupported. */
    host(): {
        bootId: string;
        pidNamespace: string;
    };
    /** `undefined` only when no such PID exists; throws on any other read failure. */
    stat(pid: number): ProcessStat | undefined;
    /** Sends SIGTERM to a PID; throws ESRCH when it is already gone. */
    terminate(pid: number): void;
}
export type ProcessIdentityState = {
    kind: "alive";
} | {
    kind: "exited";
} | {
    kind: "unknown";
    reason: string;
};
export declare function parseProcessStat(text: string): ProcessStat;
/** Linux `/proc` facts; the reader is injectable only for error-path tests. */
export declare function createLinuxProcessProbe(read?: (path: string) => string): ProcessIdentityProbe;
export declare const linuxProcessProbe: ProcessIdentityProbe;
/** The host has no process probe at all; retrying cannot make one appear. */
export declare class UnsupportedProcessPlatformError extends Error {
    constructor(message: string);
}
export interface ProcessRunResult {
    status: number | null;
    stdout: string;
    stderr: string;
    error?: Error;
}
/** Runs one fixed system tool to completion; tests inject a fake. */
export type ProcessRunner = (file: string, args: string[]) => ProcessRunResult;
export declare function parseDarwinProcessStat(text: string): ProcessStat;
/**
 * macOS facts from `ps` and `sysctl`. Start time has one-second resolution,
 * so a recycled PID is only mistaken for the original when it was reused
 * within the same second.
 */
export declare function createDarwinProcessProbe(options?: {
    run?: ProcessRunner;
    platform?: NodeJS.Platform;
}): ProcessIdentityProbe;
/** The identity probe of the platform this process runs on. */
export declare function createHostProcessProbe(platform?: NodeJS.Platform): ProcessIdentityProbe;
export declare const hostProcessProbe: ProcessIdentityProbe;
/**
 * A process's environment as it was at exec. Unlike its command line, Pi's
 * process-title rewrite leaves this intact. `undefined` only when no such PID
 * exists; throws on non-Linux hosts and any other read failure.
 */
export type ProcessEnvironmentReader = (pid: number) => Map<string, string> | undefined;
export declare function createLinuxProcessEnvironmentReader(read?: (path: string) => string): ProcessEnvironmentReader;
export declare const readLinuxProcessEnvironment: ProcessEnvironmentReader;
/** The calling process's identity; throws when this host cannot establish it. */
export declare function readOwnProcessIdentity(probe?: ProcessIdentityProbe): PiProcessIdentity;
/**
 * Publish the record atomically and only once: a torn read is impossible and
 * a later writer (a reload in the same process, or any other process) never
 * replaces the first identity.
 */
export declare function writeProcessIdentityRecord(file: string, record: PiProcessIdentityRecord): void;
/** `undefined` until the child has published; throws on a malformed record. */
export declare function readProcessIdentityRecord(file: string): PiProcessIdentityRecord | undefined;
/**
 * Whether THAT process still exists. Only an absent PID or a zombie is exit
 * evidence; a different start time, another boot or namespace, or any read
 * failure is unknown, never guessed exited.
 */
export declare function judgeProcessIdentity(identity: PiProcessIdentity, probe?: ProcessIdentityProbe): ProcessIdentityState;
/**
 * Accept a child's record only for this run and session, while it is alive in
 * this host's namespace, and only as the pane shell or a descendant of it.
 */
export declare function verifyProcessIdentityRecord(record: PiProcessIdentityRecord, expected: {
    id: string;
    sessionFile: string;
    shellPid: number;
}, probe?: ProcessIdentityProbe): PiProcessIdentity;
/**
 * SIGTERM only the recorded identity, re-verified immediately before the
 * signal. A mismatch or unreadable state is never signalled. The kernel can
 * still reuse the PID between that read and `kill(2)`; Node exposes no pidfd
 * signal to close the window.
 */
export declare function terminateProcessIdentity(identity: PiProcessIdentity, probe?: ProcessIdentityProbe): ProcessIdentityState;
//# sourceMappingURL=process-identity.d.ts.map