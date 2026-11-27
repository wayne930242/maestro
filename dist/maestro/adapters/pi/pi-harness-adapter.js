import { randomUUID } from "node:crypto";
import { accessSync, constants, existsSync, statSync } from "node:fs";
import { delimiter, join } from "node:path";
import { readSubagentActivityFile } from "./activity-file.js";
import { markCompletionDetected, markInterruptRequested, observeActivity, observePaneInspection, } from "../../core/lifecycle.js";
import { isThinkingLevel, parseExactModelRef, resolveRuntimePlan, } from "../../core/routing.js";
import { hostProcessProbe, judgeProcessIdentity, terminateProcessIdentity, } from "./process-identity.js";
import { launchOperationsFromSurface, settleBefore, } from "./launch-operations.js";
import { launchPiSubagent, AcquiredPiLaunchError, startProcessIdentityCapture, } from "./launch.js";
import { shellExitFileFor, waitForCompletion } from "./completion.js";
import { acceptLaunchRefusal } from "../../core/accept.js";
import { notifyLaunchRefusal } from "../../core/specialist-notice.js";
import { EXIT_OUTPUT_READ_TIMEOUT_MS, EXIT_OUTPUT_SCREEN_LINES, extractExitOutput, readWithin, } from "./exit-output.js";
import { appendPersistentDeliveryLedger, findObservedSessionRuntime, getNewEntries, inspectFinalAssistantMessage, readPersistentTaskEvents, writePersistentTaskInbox, } from "./session.js";
/** Pi's existing launch and child-sidecar protocol behind the harness seam. */
export class PiHarnessAdapter {
    name = "pi";
    options;
    operations;
    children = new Map();
    evidence = new Map();
    waits = new Map();
    constructor(options) {
        this.options = options;
        this.operations =
            options.operations ??
                launchOperationsFromSurface(options.surface, options.paneConfig, options.worktreeOperations);
        if (this.operations.nativeExecution !== options.surface.nativeExecution)
            throw new Error("Pi owning provider and launch operations must use the same native execution binding");
    }
    isAvailable() {
        return (process.env.PATH ?? "").split(delimiter).some((directory) => {
            try {
                const path = join(directory, "pi");
                accessSync(path, constants.X_OK);
                return statSync(path).isFile();
            }
            catch {
                return false;
            }
        });
    }
    async spawn(opts) {
        this.rejectEnvironment(opts.env);
        if (opts.worktree && !opts.worktreeRequest)
            throw new Error("Pi requires an unprovisioned worktreeRequest; it owns worktree acquisition");
        // One ordinary attempt per spawn; the run session owns retries and their evidence.
        if (opts.worktreeRequest && opts.runtime?.fallbacks?.length)
            throw new Error("Model fallbacks are not supported for worktree subagents.");
        if (opts.session?.parentSessionId &&
            opts.session.parentSessionId !== this.options.parent.sessionId)
            throw new Error("Pi session parent identity does not match the launch parent");
        const defaults = opts.role.defaults;
        const persistent = opts.behavior?.persistent ?? defaults?.persistent ?? false;
        const autoExit = persistent
            ? false
            : (opts.behavior?.autoExit ?? defaults?.autoExit ?? false);
        const interactive = opts.behavior?.interactive ??
            opts.interactive ??
            (persistent ? false : (defaults?.interactive ?? !autoExit));
        const acceptRefusal = opts.accept && acceptLaunchRefusal({ persistent, autoExit });
        if (acceptRefusal)
            throw new Error(acceptRefusal);
        const notify = opts.behavior?.notify === true;
        const notifyRefusal = notifyLaunchRefusal({ persistent, notify });
        if (notifyRefusal)
            throw new Error(notifyRefusal);
        const denied = new Set([
            ...(defaults?.denyTools ?? []),
            ...(opts.behavior?.denyTools ?? []),
        ]);
        if (defaults?.spawning === false)
            for (const name of [
                "subagent",
                "subagent_interrupt",
                "subagent_cancel",
                "subagent_send",
                "subagent_stop",
                "subagents_list",
                "subagent_resume",
            ])
                denied.add(name);
        const resolved = opts.resolvedLaunch;
        const cwd = resolved ? resolved.cwd : opts.cwd;
        const roleCwd = resolved ? resolved.roleCwd : defaults?.cwd;
        const id = opts.launchIdentity?.id ?? randomUUID();
        const taskId = opts.launchIdentity?.taskId ?? randomUUID();
        const child = await this.acquireChild({
            kind: "fresh",
            childEntryPath: this.options.childEntryPath,
            acquisitionSignal: opts.acquisitionSignal,
            id,
            name: opts.name,
            task: opts.task,
            agent: resolved ? resolved.agent : opts.role.name,
            cwd,
            worktree: opts.worktreeRequest,
            accept: opts.accept,
            // An omitted override must not force lineage-only/default fork to standalone.
            fork: opts.session
                ? opts.session.mode === "fork"
                    ? true
                    : opts.session.mode === "standalone"
                        ? false
                        : undefined
                : undefined,
            surface: opts.surface?.id,
            parent: this.options.parent,
            runtimePlan: resolved?.runtimePlan ??
                resolveRuntimePlan(opts.runtime ?? {}, defaults ?? {}, this.parentRuntime(opts), this.options.modelRegistry),
            modelScope: this.options.modelRegistry.scope,
            behavior: {
                tools: resolved
                    ? resolved.tools
                    : (opts.tools ?? opts.role.allowedTools).join(","),
                cwd: roleCwd,
                skills: (opts.behavior?.skills ?? defaults?.skills)?.join(","),
                deniedTools: [...denied],
                // `spawning: false` removes the spawning tools, so it always wins.
                selfSpawn: defaults?.selfSpawn === true && defaults.spawning !== false,
                autoExit,
                interactive,
                persistent,
                notify,
                logicalId: opts.launchIdentity?.logicalId ?? id,
                generationId: opts.launchIdentity?.generationId ?? randomUUID(),
                taskId,
                identity: opts.systemPrompt ?? opts.role.systemPrompt,
                systemPromptMode: opts.behavior?.systemPromptMode ?? defaults?.systemPromptMode,
                sessionMode: opts.session?.mode ?? defaults?.sessionMode ?? "standalone",
                solutionSpace: opts.behavior?.solutionSpace,
            },
        });
        // Launch returns a fully initialized owner; no fallible I/O may separate
        // command dispatch from tracking (a rejection could start a fallback).
        return this.track(child);
    }
    async resume(opts) {
        this.rejectEnvironment(opts.env);
        if (opts.surface)
            throw new Error("Pi public resume owns its new ordinary pane");
        if (opts.tools)
            throw new Error("Pi resume restores saved tools; tool overrides are not supported");
        const child = await this.acquireChild({
            kind: "resume",
            childEntryPath: this.options.childEntryPath,
            acquisitionSignal: opts.acquisitionSignal,
            name: opts.name,
            sessionFile: opts.sessionId,
            message: opts.message,
            parent: this.options.parent,
            modelScope: this.options.modelRegistry.scope,
            behavior: { autoExit: opts.autoExit },
        });
        return this.track(child);
    }
    async acquireChild(request) {
        try {
            return await launchPiSubagent(request, this.operations);
        }
        catch (error) {
            // The transaction transfers its fully initialized owner, not a made-up handle.
            if (error instanceof AcquiredPiLaunchError)
                return error.child;
            throw error;
        }
    }
    /** Temporary Pi-specific bridge for runtime migration; never infer task delivery from coarse state. */
    getRunningChild(handle) {
        const child = this.children.get(handle.id);
        if (!child ||
            handle.harness !== this.name ||
            handle.sessionId !== child.sessionFile)
            throw new Error(`Unknown Pi child ${handle.id}`);
        return child;
    }
    readPersistentEvents(handle) {
        const child = this.getRunningChild(handle);
        return readPersistentTaskEvents(child.sessionFile).filter((event) => event.generation === child.generationId);
    }
    async getState(handle) {
        try {
            if (handle.harness !== this.name)
                return "unknown";
            if (this.evidence.has(this.runKey(handle)))
                return "done";
            const child = this.getRunningChild(handle);
            const read = readSubagentActivityFile(child.activityFile, child.id);
            let pane;
            try {
                pane = await this.options.surface.inspectSurface(child.surface);
            }
            catch {
                pane = { kind: "unavailable" };
            }
            child.lifecycle = observeActivity(observePaneInspection(child.lifecycle, pane, Date.now()), read, Date.now());
            this.options.onObservation?.(child, "state");
            if (pane.kind !== "present")
                return "unknown";
            switch (child.lifecycle.turn.kind) {
                case "active":
                    return "working";
                case "blocked":
                case "waiting":
                    return "blocked";
                case "starting":
                    return "idle";
                default:
                    return "unknown";
            }
        }
        catch {
            return "unknown";
        }
    }
    async interrupt(handle) {
        const child = this.getRunningChild(handle);
        await this.options.surface.sendKeys(child.surface, "Escape");
        child.lifecycle = markInterruptRequested(child.lifecycle, Date.now());
        this.options.onObservation?.(child, "interrupt");
    }
    /** Resolves only with termination evidence; otherwise rejects (unconfirmed). */
    async kill(handle) {
        const child = this.getRunningChild(handle);
        if (this.options.surface.nativeExecution)
            return this.options.surface.nativeExecution.terminate(child.surface);
        // A worktree root pane is the retained review workspace (Herdr refuses to
        // close it): stop only the owned Pi process and keep pane and checkout.
        if (child.worktree || !child.ownsSurface)
            return this.stopRetainedPi(child);
        let closeError;
        try {
            await this.options.surface.closeSurface(child.surface);
        }
        catch (error) {
            // Absence is still checked: a pane that is already gone is terminated.
            closeError = error;
        }
        try {
            await this.options.surface.waitForSurfaceAbsence(child.surface);
        }
        catch (error) {
            if (closeError === undefined)
                throw error;
            throw new Error(`${errorText(closeError)}; ${errorText(error)}`);
        }
    }
    /**
     * Observation only, never a signal: the evidence kill() accepts, read again
     * later. An unconfirmed cancel polls it, so a pane closed or a Pi that
     * exited after the kill deadline still settles the run. A retained worktree
     * child is gone when its captured identity has exited, or when its pane is
     * gone while that identity is not known alive; any other child, when its
     * pane is gone. Without an identity a live pane proves nothing.
     */
    async confirmTerminated(handle) {
        let child;
        try {
            child = this.getRunningChild(handle);
        }
        catch {
            return false;
        }
        const probe = this.options.processProbe ?? hostProcessProbe;
        const identityBefore = child.worktree ? child.processIdentity : undefined;
        if (identityBefore) {
            const state = judgeProcessIdentity(identityBefore, probe);
            if (state.kind !== "unknown")
                return state.kind === "exited";
        }
        const deadline = Date.now() + (this.options.killTimeoutMs ?? 5_000);
        // Background observation never holds the process open.
        if (!(await this.paneIsMissing(child, deadline, { unref: true })))
            return false;
        // The inspection awaited: an identity captured meanwhile is judged too, and
        // confirms only while not known alive.
        const identity = child.worktree ? child.processIdentity : undefined;
        return !identity || judgeProcessIdentity(identity, probe).kind !== "alive";
    }
    /** Herdr reports the pane absent; a failure or late answer is never "gone". */
    async paneIsMissing(child, deadline, options = {}) {
        return ((await settleBefore(
        // Providers may throw synchronously or reject; both mean "unknown".
        Promise.resolve()
            .then(() => this.options.surface.inspectSurface(child.surface))
            .catch(() => undefined), deadline, options))?.kind === "missing");
    }
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
    async stopRetainedPi(child) {
        const probe = this.options.processProbe ?? hostProcessProbe;
        const retainedDescription = child.worktree
            ? "retained worktree pane"
            : "caller-provided pane";
        const timeoutMs = this.options.killTimeoutMs ?? 5_000;
        const deadline = Date.now() + timeoutMs;
        const paneGone = () => this.paneIsMissing(child, deadline);
        let identity = child.processIdentity;
        if (!identity) {
            // An expired capture gets one fresh attempt within this cancel's budget.
            if (child.processIdentityError !== undefined)
                startProcessIdentityCapture(child, this.operations, {
                    timeoutMs: Math.max(0, deadline - Date.now()),
                });
            // Inspect alongside the capture wait so absence evidence is not
            // starved by it; the identity is re-read after the inspection.
            const absence = paneGone();
            const captured = await settleBefore(child.processIdentityCapture, deadline);
            const gone = (child.processIdentity ?? captured) ? false : await absence;
            identity = child.processIdentity ?? captured;
            if (!identity) {
                if (gone)
                    return;
                throw new Error(`Owned Pi process identity was not captured for ${retainedDescription} ${child.surface}; nothing was signalled: ${describeMissingIdentity(child)}`);
            }
        }
        let signalled = false;
        const verified = identity;
        const signal = () => {
            const before = judgeProcessIdentity(verified, probe);
            if (before.kind !== "alive")
                return before;
            const after = terminateProcessIdentity(verified, probe);
            if (after.kind === "alive")
                signalled = true;
            if (after.kind !== "unknown")
                return after;
            // The identity was just known alive and the signal failed: only its
            // own exit confirms; pane absence never does.
            if (judgeProcessIdentity(verified, probe).kind === "exited")
                return { kind: "exited" };
            throw new Error(`Owned Pi process exit unconfirmed in ${retainedDescription} ${child.surface}: ${after.reason}; process ${verified.pid} was alive when signalled`);
        };
        let state = signal();
        let paneSeenGone = false;
        for (;;) {
            if (state.kind === "exited")
                return;
            // Unknown is never signalled and waiting cannot make it evidence.
            if (state.kind === "unknown") {
                if (!paneSeenGone && !(await paneGone()))
                    break;
                paneSeenGone = true;
                // The inspection awaited: confirm only while still not known alive.
                state = judgeProcessIdentity(identity, probe);
                if (state.kind === "alive" && !signalled)
                    state = signal();
                if (state.kind !== "alive")
                    return;
            }
            const remaining = deadline - Date.now();
            if (remaining <= 0)
                break;
            await new Promise((resolve) => setTimeout(resolve, Math.min(50, remaining)));
            state = judgeProcessIdentity(identity, probe);
        }
        throw new Error(`Owned Pi process exit unconfirmed in ${retainedDescription} ${child.surface}: ${describeIdentityState(identity, state, signalled, timeoutMs)}`);
    }
    async readOutput(handle, lines) {
        return this.options.surface.readScreen(this.getRunningChild(handle).surface, lines);
    }
    exitCode(handle) {
        return this.evidence.get(this.runKey(handle))?.exitCode;
    }
    async sendInput(handle, text) {
        const child = this.getRunningChild(handle);
        if (!child.persistent)
            throw new Error("child is not a persistent specialist");
        const task = randomUUID();
        const facts = {
            task,
            generation: child.generationId,
            logicalId: child.logicalId,
            policyHash: child.policyHash,
        };
        if (this.evidence.has(this.runKey(handle)) ||
            child.launchFailure ||
            child.stopState ||
            child.taskId != null ||
            child.tasksCompleted == null) {
            appendPersistentDeliveryLedger(child.sessionFile, {
                ...facts,
                outcome: "rejected-busy",
            });
            throw new Error(`Persistent specialist "${child.name}" is busy or stopped; task ${task} was rejected-busy. Resend after the pending result.`);
        }
        writePersistentTaskInbox(child.sessionFile, (child.inboxSequence = (child.inboxSequence ?? 0) + 1), { task, message: text });
        child.taskId = task;
        (child.issuedTaskIds ??= []).push(task);
        appendPersistentDeliveryLedger(child.sessionFile, {
            ...facts,
            outcome: "dispatched",
        });
    }
    async awaitCompletion(handle, signal) {
        if (signal.aborted)
            throw new Error("Aborted while waiting for subagent to finish");
        const key = this.runKey(handle);
        const recorded = this.evidence.get(key);
        if (recorded)
            return recorded;
        const child = this.getRunningChild(handle);
        let wait = this.waits.get(key);
        if (!wait || wait.controller.signal.aborted) {
            const controller = new AbortController();
            const registration = this.options.supervision.register(child.sessionFile, child.surface);
            const next = {
                controller,
                waiters: 0,
                promise: (async () => {
                    if (child.launchFailure && !this.options.surface.nativeExecution) {
                        try {
                            await this.kill(handle);
                            return {
                                reason: "error",
                                exitCode: 1,
                                errorMessage: child.launchFailure,
                                errorSource: "host",
                            };
                        }
                        catch {
                            /* unconfirmed: keep the actual owner supervised and controllable */
                        }
                    }
                    return waitForCompletion(controller.signal, {
                        intervalMs: 1000,
                        inspectExecution: this.options.surface.nativeExecution
                            ? () => this.options.surface.nativeExecution.inspect(child.surface)
                            : undefined,
                        sessionFile: child.sessionFile,
                        requireProcessExit: child.persistent || !!child.launchFailure,
                        shellExitFile: child.persistent
                            ? shellExitFileFor(child.sessionFile)
                            : undefined,
                        inspectProcess: () => child.processIdentity
                            ? judgeProcessIdentity(child.processIdentity, this.options.processProbe ?? hostProcessProbe).kind
                            : "unknown",
                        waitForNextCheck: registration.wait,
                        readTerminalTail: async () => 
                        // A caller-provided terminal can contain an earlier run's marker.
                        child.launchFailure && !child.ownsSurface && !child.worktree
                            ? ""
                            : this.options.surface.readScreen(child.surface, 5),
                        inspectPane: () => this.inspectPaneStatus(child, registration),
                        onLocalEvidence: () => this.options.onObservation?.(child, "local-evidence"),
                        onPaneInspection: (pane, at) => {
                            child.lifecycle = observePaneInspection(child.lifecycle, pane, at);
                            this.options.onObservation?.(child, "pane");
                        },
                        onTick: () => {
                            this.options.onObservation?.(child, "tick");
                        },
                    });
                })()
                    .then(async (result) => {
                    if (child.launchFailure)
                        result = {
                            ...result,
                            reason: "error",
                            exitCode: 1,
                            errorMessage: child.launchFailure,
                            errorSource: "host",
                        };
                    const entries = existsSync(child.sessionFile)
                        ? getNewEntries(child.sessionFile, 0)
                        : undefined;
                    const final = entries
                        ? inspectFinalAssistantMessage(entries)
                        : undefined;
                    const evidence = {
                        ...result,
                        sessionRef: child.sessionFile,
                    };
                    const exitOutput = await this.readExitOutput(child, result, entries);
                    if (exitOutput)
                        evidence.exitOutput = exitOutput;
                    if (final && (final.text != null || final.stopReason)) {
                        evidence.finalMessage = {
                            text: final.text ?? "",
                            stopReason: final.stopReason,
                        };
                        if (final.stopReason === "error" && result.errorMessage)
                            evidence.finalMessage.errorMessage = result.errorMessage;
                    }
                    // RunSession finalization is the single Git handoff capture owner.
                    this.evidence.set(key, evidence);
                    child.lifecycle = markCompletionDetected(child.lifecycle, result, Date.now());
                    this.options.onObservation?.(child, "completion");
                    return evidence;
                })
                    .finally(() => {
                    registration.unregister();
                    if (this.waits.get(key) === next)
                        this.waits.delete(key);
                }),
            };
            this.waits.set(key, next);
            wait = next;
        }
        return this.joinWait(wait, signal);
    }
    /**
     * The shared pane list proves presence but carries no Herdr agent status.
     * Until the child's turn is known to be waiting, read that status from its
     * own pane, so a child that ended its turn (done, idle) or opened a dialog
     * (blocked) stops projecting as active. Only a present reading replaces
     * the epoch's evidence: presence and absence stay the coordinator's.
     */
    async inspectPaneStatus(child, registration) {
        const epoch = await registration.inspectPane();
        if (epoch.kind !== "present" ||
            epoch.agentStatus !== "unknown" ||
            child.lifecycle.turn.kind === "waiting")
            return epoch;
        try {
            const own = await this.options.surface.inspectSurface(child.surface);
            return own.kind === "present" ? own : epoch;
        }
        catch {
            return epoch;
        }
    }
    /**
     * A child that failed before its session started has no transcript to
     * explain it; relay the terminal's last lines instead (#149).
     */
    async readExitOutput(child, result, entries) {
        if (result.exitCode === 0 ||
            result.errorMessage ||
            entries?.some((entry) => entry.type === "message"))
            return undefined;
        // The output only explains the failure; a terminal that cannot be read
        // in time leaves the exit code as the result.
        const screen = await readWithin(() => this.options.surface.readScreen(child.surface, EXIT_OUTPUT_SCREEN_LINES), EXIT_OUTPUT_READ_TIMEOUT_MS);
        return screen === undefined
            ? undefined
            : extractExitOutput(screen, child.launchScriptFile);
    }
    joinWait(wait, signal) {
        wait.waiters++;
        const abort = () => rejectWait(new Error("Aborted while waiting for subagent to finish"));
        let rejectWait;
        return new Promise((resolve, reject) => {
            rejectWait = reject;
            signal.addEventListener("abort", abort, { once: true });
            wait.promise.then(resolve, reject);
        }).finally(() => {
            // Each consumer owns only its cancellation, never another consumer's wait.
            signal.removeEventListener("abort", abort);
            wait.waiters--;
            if (wait.waiters === 0)
                wait.controller.abort();
        });
    }
    runKey(handle) {
        // Legacy fallback retries reuse the opaque child ID, but create a new Pi session.
        return JSON.stringify([handle.id, handle.sessionId]);
    }
    track(child) {
        this.children.set(child.id, child);
        const handle = {
            id: child.id,
            name: child.name,
            role: child.agent ?? "",
            harness: this.name,
            cwd: child.cwd,
            startedAt: child.startTime,
            sessionId: child.sessionFile,
            surfaceId: child.surface,
        };
        if (child.launchFailure)
            handle.launchFailure = child.launchFailure;
        if (child.worktree)
            handle.worktree = {
                id: child.id,
                owner: "maestro",
                branch: child.worktree.branch,
                baseRef: child.worktree.baseRef,
                baseSha: child.worktree.baseSha,
                createdAt: child.startTime,
                path: child.worktree.path,
                state: child.launchFailure ? "failed" : "running",
                manifestFile: child.worktree.manifestFile,
            };
        return handle;
    }
    parentRuntime(opts) {
        if (this.options.parentRuntime)
            return this.options.parentRuntime;
        const observed = existsSync(this.options.parent.sessionFile)
            ? findObservedSessionRuntime(getNewEntries(this.options.parent.sessionFile, 0))
            : {};
        if (observed.provider &&
            observed.modelId &&
            observed.thinking &&
            isThinkingLevel(observed.thinking))
            return {
                provider: observed.provider,
                modelId: observed.modelId,
                thinking: observed.thinking,
            };
        const model = parseExactModelRef(opts.runtime?.model ?? opts.role.defaults?.model ?? "");
        const thinking = opts.runtime?.thinking ?? opts.role.defaults?.thinking;
        if (model && thinking)
            return { ...model, thinking };
        throw new Error("Pi launch requires the active parent runtime or explicit model and thinking");
    }
    rejectEnvironment(env) {
        if (env && Object.keys(env).length)
            throw new Error("The existing Pi launch protocol does not support per-child environment overrides");
    }
}
function errorText(cause) {
    return cause instanceof Error ? cause.message : String(cause);
}
// A restarted capture clears the stored error, so the earlier failure is kept
// apart: "still pending" alone hides why the first attempt gave up.
function describeMissingIdentity(child) {
    if (child.processIdentityError !== undefined)
        return child.processIdentityError;
    if (!child.processIdentityCapture)
        return "no identity was recorded at launch";
    return child.processIdentityLastError
        ? `identity capture is still pending; the previous attempt failed: ${child.processIdentityLastError}`
        : "identity capture is still pending";
}
function describeIdentityState(identity, state, signalled, timeoutMs) {
    if (state.kind === "unknown")
        return `${state.reason}${signalled ? " after SIGTERM" : "; not signalled"}`;
    return `process ${identity.pid} (start time ${identity.startTime}) is still ${state.kind} ${timeoutMs}ms after SIGTERM`;
}
//# sourceMappingURL=pi-harness-adapter.js.map