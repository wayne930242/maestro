import type { HarnessAdapter, ResumeOptions, SpawnOptions } from "../../core/harness-adapter.ts";
import type { AgentHandle, AgentState, CompletionEvidence } from "../../core/types.ts";
import type { SurfaceProvider } from "../../core/surface-provider.ts";
import type { PaneConfig } from "../../core/config/pane-config.ts";
import { type ModelRegistryAdapter, type ParentRuntime, type ResolvedRuntimePlan } from "../../core/routing.ts";
import type { FileWakeRegistry } from "../../core/wake.ts";
import type { SupervisionCoordinator } from "../../core/supervision.ts";
import { type ProcessIdentityProbe } from "./process-identity.ts";
import { type PiLaunchOperations } from "./launch-operations.ts";
import { type FreshPiLaunchRequest, type PiRunningChild } from "./launch.ts";
import type { WorktreeOperations } from "../../core/worktree.ts";
export interface PiSpawnOptions extends SpawnOptions {
    /** Pi host normalization: retain validation/provenance and raw cwd/config origins.
     * Presence selects this snapshot, including intentionally omitted agent/tools/cwd.
     * Generic callers continue to resolve their role/runtime through the adapter.
     */
    resolvedLaunch?: {
        runtimePlan: ResolvedRuntimePlan;
        agent?: string;
        cwd?: string;
        roleCwd?: string;
        tools?: string;
    };
    /** Preserve opaque host identities during the staged migration. Not the core task/session ID. */
    launchIdentity?: {
        id?: string;
        logicalId?: string;
        generationId?: string;
        taskId?: string;
    };
}
export interface PiHarnessAdapterOptions {
    childEntryPath?: string;
    surface: SurfaceProvider;
    paneConfig: PaneConfig;
    modelRegistry: ModelRegistryAdapter;
    parent: FreshPiLaunchRequest["parent"];
    /** Compatibility only; supervision owns its wake registry and registrations. */
    wake?: FileWakeRegistry;
    supervision: SupervisionCoordinator;
    /** The active parent's registry runtime can precede persisted model-change entries. */
    parentRuntime?: ParentRuntime;
    /** Optional launch-operation injection, keeping the real Pi protocol in unit tests. */
    operations?: PiLaunchOperations;
    worktreeOperations?: WorktreeOperations;
    /** Kernel process facts for a retained worktree child's identity; tests inject it. */
    processProbe?: ProcessIdentityProbe;
    /** Bound for confirming a retained worktree child's exit. Default: 5000ms. */
    killTimeoutMs?: number;
    /** Explicit local evidence/lifecycle bridge. The host still owns delivery and deduplication. */
    onObservation?(child: PiRunningChild, kind: "local-evidence" | "pane" | "tick" | "completion" | "state" | "interrupt"): void;
}
/** Pi's existing launch and child-sidecar protocol behind the harness seam. */
export declare class PiHarnessAdapter implements HarnessAdapter {
    readonly name = "pi";
    private readonly options;
    private readonly operations;
    private readonly children;
    private readonly evidence;
    private readonly waits;
    constructor(options: PiHarnessAdapterOptions);
    isAvailable(): boolean;
    spawn(opts: PiSpawnOptions): Promise<AgentHandle>;
    resume(opts: ResumeOptions): Promise<AgentHandle>;
    private acquireChild;
    /** Temporary Pi-specific bridge for runtime migration; never infer task delivery from coarse state. */
    getRunningChild(handle: AgentHandle): PiRunningChild;
    readPersistentEvents(handle: AgentHandle): import("./session.ts").PersistentTaskEvent[];
    getState(handle: AgentHandle): Promise<AgentState>;
    interrupt(handle: AgentHandle): Promise<void>;
    /** Resolves only with termination evidence; otherwise rejects (unconfirmed). */
    kill(handle: AgentHandle): Promise<void>;
    /**
     * Observation only, never a signal: the evidence kill() accepts, read again
     * later. An unconfirmed cancel polls it, so a pane closed or a Pi that
     * exited after the kill deadline still settles the run. A retained worktree
     * child is gone when its captured identity has exited, or when its pane is
     * gone while that identity is not known alive; any other child, when its
     * pane is gone. Without an identity a live pane proves nothing.
     */
    confirmTerminated(handle: AgentHandle): Promise<boolean>;
    /** Herdr reports the pane absent; a failure or late answer is never "gone". */
    private paneIsMissing;
    /**
     * Exit evidence is only the launch-verified identity (PID + start time, on
     * this boot and PID namespace) no longer existing, or a gone pane while that
     * identity is not known alive. SIGTERM goes only to that identity,
     * re-verified first; without it nothing is signalled and the cancel stays
     * unconfirmed. A failed SIGTERM to a live identity stays unconfirmed unless
     * that identity then exits. Herdr's foreground list and argv text are never
     * evidence.
     * Every provider await is bounded by the deadline, and a late answer is
     * dropped, so an unconfirmed outcome is reported on time and never flipped.
     */
    private stopRetainedPi;
    readOutput(handle: AgentHandle, lines?: number): Promise<string>;
    exitCode(handle: AgentHandle): number | undefined;
    sendInput(handle: AgentHandle, text: string): Promise<void>;
    awaitCompletion(handle: AgentHandle, signal: AbortSignal): Promise<CompletionEvidence>;
    /**
     * A child that failed before its session started has no transcript to
     * explain it; relay the terminal's last lines instead (#149).
     */
    private readExitOutput;
    private joinWait;
    private runKey;
    private track;
    private parentRuntime;
    private rejectEnvironment;
}
//# sourceMappingURL=pi-harness-adapter.d.ts.map