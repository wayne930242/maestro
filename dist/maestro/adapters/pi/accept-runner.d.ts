import { type AcceptCommandResult, type AcceptSpec } from "../../core/accept.ts";
import { type AcceptCheckOwner } from "./accept-groups.ts";
import { type ProcessTreeOptions } from "./process-tree.ts";
export interface AcceptCommandOptions {
    run: string;
    cwd: string;
    timeoutMs: number;
    /** Aborting stops the check like a timeout and reports `aborted`. */
    signal?: AbortSignal;
    /** SIGTERM to the process group (POSIX), then SIGKILL after this grace. */
    killGraceMs?: number;
    env?: NodeJS.ProcessEnv;
    /** Stops this check at its shutdown (`accept-groups.ts`). */
    owner?: AcceptCheckOwner;
}
/** Runs one accept check; injectable so tests need no real commands. */
export type AcceptRunner = (options: AcceptCommandOptions) => Promise<AcceptCommandResult>;
/**
 * The check's environment: the caller's, without `PI_SUBAGENT_*`, so a nested
 * Pi inside the check never acts as this child.
 */
export declare function acceptCheckEnv(env?: NodeJS.ProcessEnv): NodeJS.ProcessEnv;
/**
 * `sh -c <run>` in `cwd`, asynchronously, with a timeout. Keeps the last 64 KiB
 * of combined output. A timeout or abort sends SIGTERM to the process group
 * and SIGKILL after the grace; whatever is left of the group is killed once
 * the shell exits. Windows has no groups or signals, so `taskkill /T /F` ends
 * the tree while the shell still runs (never after it exits: the pid may then
 * belong to an unrelated process) and any stop there is immediate. After the shell exits, the check waits briefly for
 * inherited pipes to close; a timeout or abort then ends it at once. The
 * group is tracked under `owner` until it is killed (`accept-groups.ts`).
 */
export declare function createAcceptRunner(processTree?: ProcessTreeOptions): AcceptRunner;
export declare const runAcceptCommand: AcceptRunner;
/** The child's spec file; unreadable or invalid means no child loop. */
export declare function readAcceptSpecFile(file: string | undefined): AcceptSpec | undefined;
//# sourceMappingURL=accept-runner.d.ts.map