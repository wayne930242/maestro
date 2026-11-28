import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { PiHarnessAdapter } from "../adapters/pi/pi-harness-adapter.js";
import { launchOperationsFromSurface, } from "../adapters/pi/launch-operations.js";
import { launchPiWorktreeHandoff } from "../adapters/pi/launch.js";
import { createWorktreeOperations, createWorktreeCleanupOperations, } from "./worktree-operations.js";
import { worktreeResultState, } from "../core/worktree.js";
import { getNewEntries, findLastAssistantSummary, findObservedSessionRuntime, inspectNoProgressSessionTail, } from "../adapters/pi/session.js";
import { assertManagedWorktreesSupported, managedWorktreeRefusal, } from "../core/platform-support.js";
import { assertSameHerdrBinding, } from "../core/config/herdr-config.js";
import { createPiScriptShellResolver } from "../adapters/pi/script-shell.js";
import { readSubagentActivityFile } from "../adapters/pi/activity-file.js";
import { projectActivity } from "../core/activity.js";
import { markCompletionDetected, markCompleted, markFailed, markDelivery, observeActivity, projectLifecycle, } from "../core/lifecycle.js";
import { FileWakeRegistry } from "../core/wake.js";
import { SupervisionCoordinator } from "../core/supervision.js";
import { assertModelInScope, isThinkingLevel, resolveRuntimePlan, resolveRuntimePlans, } from "../core/routing.js";
import { loadPaneConfig } from "../core/config/pane-config.js";
import { DelegatedMarkers } from "./delegated-marker.js";
import { createRunSession, } from "./run-session.js";
import { createPiPersistentIO } from "./pi-persistent-io.js";
import { appendOutcomeLedger, ledgerOutcome, outcomeLedgerFile, runParentAcceptCheck, } from "./accept-recheck.js";
import { WORK_ITEM_PATTERN } from "../core/accept.js";
import { isString } from "../core/config/type-guards.js";
import { runAcceptCommand } from "../adapters/pi/accept-runner.js";
import { terminateAcceptChecks, } from "../adapters/pi/accept-groups.js";
// pi-herdr-agents extension; no owning session required
export function observePiActivity(input, observedAt) {
    const read = input.activityFile
        ? readSubagentActivityFile(input.activityFile, input.id)
        : projectActivity(undefined);
    const lifecycle = observeActivity(input.lifecycle, read, observedAt);
    return {
        kind: "refresh",
        observedAt,
        lifecycle,
        projection: projectLifecycle(lifecycle, observedAt),
        activity: read.ok ? read.activity : undefined,
        activityRead: read,
    };
}
// The previous facade carries its live composition explicitly across module replacement.
// No module-local lookup can accidentally rediscover an owner.
const OWNER = Symbol.for("pi-herdr-agents/PiRunSession-owner");
// A detached close can outlive settlement without capturing a child, metadata,
// adapter, current hook binding or the composition registry.
function temporarySurfaceRelease(provider, surface) {
    return async () => {
        // Suppression may release before a watcher observes native exit. Like a
        // legacy pane close, stop the owned program, but remove its record only
        // after independent exit confirmation and delivery/suppression gating.
        await provider.nativeExecution?.terminate(surface);
        await provider.closeSurface(surface);
    };
}
function createDelegatedMarkers(options) {
    const transport = options.infrastructure
        ? {
            write: options.infrastructure.markerWriter,
            readSession: options.infrastructure.markerSessionReader,
        }
        : options.hostSurface.markers?.();
    return transport?.write && transport.readSession
        ? new DelegatedMarkers({
            write: transport.write,
            readSession: transport.readSession,
        })
        : undefined;
}
/** Host diagnostics stay host; only text the child wrote is child-error. */
function errorProvenance(source) {
    return source === "child" ? "child-error" : "host";
}
// Capture only resume presentation scalars, not the child or its owning registry.
function resumeResultReader(sessionFile, cursor, exitCode, errorMessage, errorSource) {
    return () => ({
        ...(findLastAssistantSummary(getNewEntries(sessionFile, cursor)) ?? {
            summary: errorMessage
                ? `Subagent error: ${errorMessage}`
                : exitCode === 0
                    ? "Resumed session exited without new output"
                    : `Resumed session exited with code ${exitCode}`,
            summarySource: errorProvenance(errorSource),
        }),
        sessionFile,
    });
}
// pi-herdr-agents extension
export function createDefaultRunSession(options, previous) {
    // SAFETY: this factory alone attaches its private symbol owner to Pi facades.
    const adopted = previous &&
        previous[OWNER];
    if (previous && !adopted)
        throw new Error("Previous PiRunSession does not carry its owning composition.");
    if (options.infrastructure &&
        options.infrastructure.launchOperations.nativeExecution !==
            options.infrastructure.surfaceProvider.nativeExecution)
        throw new Error("Pi owning provider and launch operations must use the same native execution binding");
    if (!options.infrastructure && !options.hostSurface)
        throw new Error("Pi run session requires a host surface binding");
    // Injected infrastructure is a closed world: never inspect ambient Core sockets.
    const binding = options.infrastructure
        ? { backend: "legacy" }
        : options.hostSurface.resolve(options.configDir, options.configExamplePath, options.platform);
    if (adopted) {
        assertSameHerdrBinding(adopted.binding, binding);
        const previousNative = adopted.infrastructure.surfaceProvider.nativeExecution;
        const nextNative = options.infrastructure?.surfaceProvider.nativeExecution;
        if (options.infrastructure && previousNative !== nextNative)
            throw new Error("Injected native execution binding changed; restart Pi");
    }
    let state;
    let resumePi;
    if (adopted) {
        state = adopted;
        const supervision = state.infrastructure.supervision;
        if (supervision.setForcePolling) {
            supervision.setForcePolling(options.forcePolling);
        }
        else if ((supervision.diagnostics().mode === "polling(forced)") !==
            options.forcePolling) {
            // An owner created before live reconfiguration cannot transfer its
            // registrations safely. Never silently replace it or ignore config.
            throw new Error("Cannot change supervision.forcePolling on a pre-upgrade coordinator. Let active children finish, then restart Pi to apply it.");
        }
        state.options = options;
        state.roles.splice(0, state.roles.length, ...options.roles);
    }
    else {
        // Configured placement belongs to each new launch; the coordinator alone owns
        // this explicitly injected registry. Injected infrastructure already owns one.
        const provider = options.infrastructure?.surfaceProvider ??
            options.hostSurface.createProvider(binding, loadPaneConfig(join(options.configDir, "herdr-agents"), options.configExamplePath), 
            // No launch context here, so project settings are untrusted.
            createPiScriptShellResolver({
                cwd: process.cwd(),
                projectTrusted: false,
            }));
        const wake = options.infrastructure ? undefined : new FileWakeRegistry();
        const supervision = options.infrastructure?.supervision ??
            new SupervisionCoordinator(async () => {
                try {
                    return {
                        complete: true,
                        panes: (await provider.listSurfaces()).map((s) => ({
                            paneId: s.id,
                            workspaceId: s.workspaceId ?? "",
                        })),
                    };
                }
                catch {
                    return { complete: false, panes: [] };
                }
            }, (id) => provider.inspectSurface(id), options.forcePolling, wake);
        const infrastructure = options.infrastructure ?? {
            surfaceProvider: provider,
            supervision,
        };
        const entries = new Map();
        const roles = [...options.roles];
        const pending = new Set();
        // The operations always supply an actual owning adapter. The lazy default is
        // an actual Pi adapter too, only constructed if the generic default is used.
        const kernel = createRunSession({
            get adapter() {
                return adapter(state.options.getLaunchSnapshot());
            },
            roles,
            cwd: process.cwd(),
            terminationRecheckMs: options.infrastructure?.terminationRecheckMs,
            operations: {
                async prepare(task, role) {
                    if (task.worktree)
                        assertManagedWorktreesSupported(state.options.platform);
                    const snapshot = state.options.getLaunchSnapshot();
                    if (!snapshot.parentRuntime)
                        throw new Error("Pi launch requires the active parent runtime");
                    const plans = resolveRuntimePlans(task.runtime ?? {}, role.defaults ?? {}, snapshot.parentRuntime, snapshot.modelRegistry);
                    for (const candidate of task.runtime?.fallbacks ?? [])
                        plans.push(resolveRuntimePlan(candidate, role.defaults ?? {}, snapshot.parentRuntime, snapshot.modelRegistry));
                    const [first, ...rest] = plans;
                    if (!first)
                        throw new Error("No resolved runtime plans");
                    const id = randomUUID();
                    return prepare({
                        task,
                        role,
                        plans: [first, ...rest],
                        resolved: {
                            agent: role.name || undefined,
                            cwd: task.cwd,
                            tools: task.tools?.join(","),
                        },
                        identity: {
                            id,
                            logicalId: id,
                            generationId: randomUUID(),
                            taskId: randomUUID(),
                        },
                    }, snapshot);
                },
                async resume(resumeOptions, task) {
                    const acquisition = { taskId: task.id, suppressed: false };
                    state.pending.add(acquisition);
                    try {
                        const snapshot = state.options.getLaunchSnapshot();
                        const before = getNewEntries(resumeOptions.sessionId, 0);
                        const owner = adapter(snapshot);
                        const handle = await owner.resume(resumeOptions);
                        task.cwd = handle.cwd;
                        return acquired(task, snapshot.parent.sessionId, owner, handle, [], [], [], undefined, before.length, acquisition.suppressed);
                    }
                    finally {
                        state.pending.delete(acquisition);
                    }
                },
            },
            hooks: {
                async onSpawned(_handle, task) {
                    const entry = entries.get(task.id);
                    await state.options.hooks.onSpawned?.(entry.record, entry.started, task);
                },
                onCancelState(handle, task, cancelState) {
                    // The kernel owns the intent; project it onto whichever owner is
                    // current, including one transferred after the cancel call.
                    const entry = entries.get(task.id);
                    if (entry &&
                        entry.record.id === handle.id &&
                        entry.record.sessionFile === handle.sessionId)
                        entry.record.cancelState = cancelState;
                },
                onObserved(_handle, _projection, observation) {
                    const entry = [...entries.values()].find((e) => e.record.id === _handle.id &&
                        e.record.sessionFile === _handle.sessionId);
                    if (entry)
                        observed(entry.record, observation);
                },
                async onSettled(result, task) {
                    const entry = entries.get(task.id);
                    // Exhausted acquisition failures are attached by the generic kernel after
                    // the last real attempt was finalized; preserve its original raw text.
                    const completed = { ...entry.completed, run: result };
                    if (result.evidence?.errorMessage !== undefined)
                        completed.errorMessage = result.evidence.errorMessage;
                    if (result.cancellation) {
                        // A cancel can settle after a retryable attempt was finalized with
                        // its natural error; present the run's actual cancelled outcome.
                        completed.summary = "Subagent cancelled.";
                        completed.summarySource = "host";
                        completed.error = "cancelled";
                        completed.exitCode = 1;
                        completed.sessionFile = entry.record.sessionFile;
                        completed.errorMessage = undefined;
                        completed.ping = undefined;
                    }
                    entry.completed = completed;
                    try {
                        const decision = await state.options.hooks.onSettled(entry.record, completed, task, entry.readResumeResult
                            ? { ...io, readResumeResult: entry.readResumeResult }
                            : io);
                        entry.record.lifecycle = markDelivery(entry.record.lifecycle, decision === "suppressed" ? "suppressed" : "delivered");
                        return decision;
                    }
                    finally {
                        entries.delete(task.id);
                    }
                },
            },
        });
        // Reserve through kernel.resume before any transcript read or adapter creation.
        resumePi = async (input) => {
            const task = {
                id: input.taskId,
                name: input.name,
                prompt: input.message ?? "resumed session",
                role: "",
                cwd: process.cwd(),
            };
            try {
                return await kernel.resume({
                    task,
                    name: input.name,
                    sessionId: input.sessionPath,
                    message: input.message,
                    autoExit: input.autoExit,
                });
            }
            finally {
                prune(task.id);
            }
        };
        state = {
            binding,
            options,
            kernel,
            entries,
            infrastructure,
            roles,
            pending,
            resumePi,
            worktreeOperations: options.infrastructure?.worktreeOperations ??
                options.infrastructure?.launchOperations.worktree ??
                createWorktreeOperations(),
        };
    }
    // Replacements must invoke the original kernel's invocation closure, which
    // reads this shared current binding, not the old facade's options.
    if (adopted)
        resumePi = state.resumePi;
    // Live markers and their sequence survive a reload with their runs.
    if (state.binding.backend === "legacy" &&
        !state.infrastructure.surfaceProvider.nativeExecution)
        state.markers ??= createDelegatedMarkers(options);
    const acceptChecks = (state.acceptChecks ??= {
        label: "parent run session",
    });
    function prune(id) {
        if (!state.kernel.getTask(id))
            state.entries.delete(id);
    }
    function live(id) {
        prune(id);
        return state.entries.get(id);
    }
    function record(id) {
        const value = live(id)?.record;
        if (!value)
            throw new Error(`Task "${id}" has no active Pi owner.`);
        return value;
    }
    function hydrate(child, at, kind) {
        const read = readSubagentActivityFile(child.activityFile, child.id);
        child.lifecycle = observeActivity(child.lifecycle, read, at);
        return {
            kind,
            observedAt: at,
            lifecycle: child.lifecycle,
            projection: projectLifecycle(child.lifecycle, at),
            activity: read.ok ? read.activity : undefined,
            activityRead: read,
        };
    }
    function observed(child, observation) {
        const entry = [...state.entries.values()].find((candidate) => candidate.record === child);
        if (child.lifecycle.delivery === "suppressed" || !entry)
            return;
        entry.marker?.renew();
        if (observation.kind === "local-evidence" && child.persistent) {
            try {
                state.options.persistent.drain(child, io);
            }
            catch {
                /* unread event retries on a later wake */
            }
        }
        state.options.hooks.onObserved?.(child, observation);
    }
    function launchOperations(snapshot) {
        return {
            ...(state.options.infrastructure?.launchOperations ??
                launchOperationsFromSurface(state.binding.backend === "core"
                    ? state.infrastructure.surfaceProvider
                    : state.options.hostSurface.createLaunchProvider(snapshot), snapshot.paneConfig)),
            worktree: state.worktreeOperations,
        };
    }
    function adapter(snapshot) {
        return new PiHarnessAdapter({
            childEntryPath: state.options.childEntryPath,
            surface: state.infrastructure.surfaceProvider,
            paneConfig: snapshot.paneConfig,
            modelRegistry: snapshot.modelRegistry,
            parent: snapshot.parent,
            parentRuntime: snapshot.parentRuntime,
            supervision: state.infrastructure.supervision,
            processProbe: state.infrastructure.processProbe,
            operations: launchOperations(snapshot),
            onObservation(child, kind) {
                const at = Date.now();
                // Local evidence only drains events. Tick/refresh still hydrate fresh
                // activity; preserve the callback without another activity-file parse.
                observed(child, kind === "local-evidence"
                    ? {
                        kind,
                        observedAt: at,
                        lifecycle: child.lifecycle,
                        projection: projectLifecycle(child.lifecycle, at),
                    }
                    : hydrate(child, at, kind));
            },
        });
    }
    function acquired(task, parent, owner, handle, attempts, failures, spawned, warning, cursor, suppressed = false) {
        const child = owner.getRunningChild(handle);
        const entry = {
            record: child,
            started: {
                id: child.id,
                name: child.name,
                ...(task.item !== undefined && { item: task.item }),
                task: child.task,
                agent: child.agent,
                sessionFile: child.sessionFile,
                launchScriptFile: child.launchScriptFile,
                model: child.runtimePlan?.model,
                thinking: child.runtimePlan?.thinking,
                runtimePlan: child.runtimePlan,
                worktree: child.worktree,
                warning,
                status: child.launchFailure ? "uncertain" : "started",
                launchFailure: child.launchFailure,
            },
        };
        if (suppressed)
            child.lifecycle = markDelivery(child.lifecycle, "suppressed");
        else {
            entry.marker = state.markers?.attach(child);
            state.entries.set(task.id, entry);
        }
        return {
            handle,
            adapter: owner,
            persistent: child.persistent ?? false,
            closeTemporarySurface: child.ownsSurface
                ? temporarySurfaceRelease(state.infrastructure.surfaceProvider, child.surface)
                : undefined,
            observe: (at) => hydrate(child, at, "refresh"),
            finalize: async (result, _task, control) => {
                // Clear before delivery; a retained worktree root keeps its pane.
                entry.marker?.retire();
                const at = Date.now();
                let evidence = result.evidence;
                if (evidence)
                    child.lifecycle = markCompletionDetected(child.lifecycle, evidence, at);
                // A rejected adapter wait follows the shipped watch error result:
                // transcript I/O is not retried as part of presenting that failure.
                let all = [];
                try {
                    if (evidence && existsSync(child.sessionFile))
                        all = getNewEntries(child.sessionFile, 0);
                }
                catch (error) {
                    // This is Pi processing failure AFTER real adapter evidence, not a
                    // provider error or a failed parent send. Normalize to the shipped
                    // watch error result and settle once; no synthetic evidence/retry.
                    result = {
                        handle: result.handle,
                        outcome: "failed",
                        error: error instanceof Error ? error.message : String(error),
                        durationMs: result.durationMs,
                    };
                    evidence = undefined;
                }
                const exitCode = evidence?.exitCode ?? 1;
                const observedRuntime = findObservedSessionRuntime(all);
                if (child.runtimePlan &&
                    observedRuntime.provider &&
                    observedRuntime.modelId) {
                    const model = `${observedRuntime.provider}/${observedRuntime.modelId}`;
                    const thinking = observedRuntime.thinking !== undefined &&
                        isThinkingLevel(observedRuntime.thinking)
                        ? observedRuntime.thinking
                        : undefined;
                    const plan = {
                        ...child.runtimePlan,
                        observed: { model },
                    };
                    if (thinking) {
                        plan.thinking = thinking;
                        plan.observed.thinking = thinking;
                    }
                    if (model !== plan.model)
                        plan.runtimeMismatch = `Resolved model ${plan.model} but child reported ${model}`;
                    child.runtimePlan = plan;
                }
                const { summary, summarySource } = evidence
                    ? (findLastAssistantSummary(cursor === undefined ? all : all.slice(cursor)) ?? {
                        summary: evidence.errorMessage
                            ? `Subagent error: ${evidence.errorMessage}`
                            : exitCode === 0
                                ? cursor === undefined
                                    ? "Sub-agent exited without output"
                                    : "Resumed session exited without new output"
                                : `${cursor === undefined ? "Sub-agent" : "Resumed session"} exited with code ${exitCode}${evidence.exitOutput ? ` before its session started. Last output:\n${evidence.exitOutput}` : ""}`,
                        // Only a child-written sidecar error is child provenance.
                        summarySource: evidence.errorMessage
                            ? errorProvenance(evidence.errorSource)
                            : "host",
                    })
                    : {
                        summary: result.outcome === "killed"
                            ? "Subagent cancelled."
                            : `Subagent error: ${result.error}`,
                        summarySource: "host",
                    };
                let worktree = child.worktree
                    ? await state.worktreeOperations.captureWorktreeHandoff(child.worktree)
                    : undefined;
                // After the handoff capture, before the lifecycle and manifest marks:
                // the parent re-check decides the verdict (ADR-0017).
                const accept = child.accept
                    ? await runParentAcceptCheck({
                        spec: child.accept,
                        result,
                        evidence,
                        exitCode,
                        cwd: child.cwd,
                        worktree,
                        control,
                        runner: state.infrastructure.acceptRunner ?? runAcceptCommand,
                        owner: acceptChecks,
                    })
                    : undefined;
                // A cancel that won during the re-check, with termination confirmed,
                // delivers the cancelled result: the kernel says so, not the check.
                const cancelledInCheck = !result.cancellation && control.interruption() === "cancelled";
                if (child.worktree && worktree) {
                    try {
                        // Only confirmed termination is a cancellation. Shutdown suppression
                        // of an unconfirmed cancel records what a plain shutdown would. A
                        // rejected verdict leaves the manifest state unchanged.
                        state.worktreeOperations.persistWorktreeResult(child.worktree, result.cancellation?.termination === "confirmed" ||
                            cancelledInCheck
                            ? "cancelled"
                            : worktreeResultState(exitCode, !!evidence?.ping), worktree);
                    }
                    catch (error) {
                        worktree = {
                            ...worktree,
                            gitError: [
                                worktree.gitError,
                                `Manifest update failed: ${error instanceof Error ? error.message : String(error)}`,
                            ]
                                .filter(Boolean)
                                .join("; "),
                        };
                    }
                }
                child.lifecycle =
                    exitCode === 0 && !cancelledInCheck
                        ? markCompleted(child.lifecycle, at)
                        : markFailed(child.lifecycle, cancelledInCheck ? "Subagent cancelled." : summary, at, cancelledInCheck ? 1 : exitCode);
                if (evidence?.errorMessage)
                    failures.push({
                        model: child.runtimePlan?.model ?? attempts.at(-1),
                        error: evidence.errorMessage,
                    });
                entry.completed = {
                    run: result,
                    name: child.name,
                    task: child.task,
                    agent: child.agent,
                    summary,
                    summarySource,
                    sessionFile: evidence || result.outcome === "killed"
                        ? child.sessionFile
                        : undefined,
                    exitCode,
                    elapsed: Math.floor((at - child.startTime) / 1000),
                    error: evidence
                        ? undefined
                        : result.outcome === "killed"
                            ? "cancelled"
                            : result.error,
                    errorMessage: evidence?.errorMessage,
                    ping: evidence?.ping,
                    // The watch catch omits its result plan; the host still reports the
                    // live child's plan in structured details, not in the error summary.
                    runtimePlan: evidence ? child.runtimePlan : undefined,
                    worktree,
                    accept,
                    logicalId: child.logicalId,
                    generationId: child.generationId,
                    policyHash: child.policyHash,
                };
                // Every spawned attempt, a failed fallback's too: a host that books a
                // run's spend reads each attempt's file, not only the last one's.
                const attemptModel = child.runtimePlan?.observed?.model ??
                    child.runtimePlan?.model ??
                    (observedRuntime.provider && observedRuntime.modelId
                        ? `${observedRuntime.provider}/${observedRuntime.modelId}`
                        : attempts.at(-1));
                spawned.push({
                    ...(attemptModel !== undefined && { model: attemptModel }),
                    sessionFile: child.sessionFile,
                    elapsed: entry.completed.elapsed,
                });
                entry.completed.attempts = [...spawned];
                if (state.options.outcomeLedger !== false)
                    appendOutcomeLedger(outcomeLedgerFile(state.options.configDir), {
                        at,
                        runId: child.id,
                        name: task.name,
                        parent,
                        item: task.item,
                        attempt: Math.max(1, attempts.length),
                        role: child.agent,
                        requestedModel: task.requestedModel ?? child.runtimePlan?.requestedModel,
                        model: child.runtimePlan?.observed?.model ?? child.runtimePlan?.model,
                        thinking: child.runtimePlan?.thinking,
                        elapsedSec: entry.completed.elapsed,
                        outcome: ledgerOutcome(result, evidence, exitCode, cancelledInCheck),
                        accept,
                    });
                if (cursor !== undefined)
                    entry.readResumeResult = resumeResultReader(child.sessionFile, cursor, exitCode, evidence?.errorMessage, evidence?.errorSource);
                if (cursor === undefined) {
                    entry.completed.fallbackAttempts = attempts;
                    entry.completed.fallbackFailures = failures;
                }
                return worktree && evidence
                    ? { ...result, evidence: { ...evidence, worktree } }
                    : result;
            },
        };
    }
    function prepare(input, snapshot) {
        const item = input.task.item;
        if (item !== undefined &&
            (!isString(item) || !WORK_ITEM_PATTERN.test(item)))
            throw new Error("Invalid work item: expected a todo uid or <session8>#<id>.");
        // A fallback may prepare from a replacement session; the launch still belongs to its caller.
        let parent = input.task.session?.parentSessionId ?? snapshot?.parent.sessionId;
        const attempts = [];
        const failures = [];
        const spawned = [];
        let publicId;
        let logicalId;
        let capturedSnapshot = snapshot;
        return {
            role: input.role,
            persistent: input.task.behavior?.persistent ??
                input.role.defaults?.persistent ??
                false,
            candidates: input.plans,
            async spawnAttempt(_spawn, index, signal) {
                // A kernel adopted across /reload from before d027daa passes no signal;
                // it cannot cancel an acquisition, so a never-aborted one stands in.
                const cancelled = signal ?? new AbortController().signal;
                const plan = input.plans[index];
                attempts.push(plan.model);
                const acquisition = { taskId: input.task.id, suppressed: false };
                state.pending.add(acquisition);
                let spawning = false;
                try {
                    const current = (await input.prepareAttempt?.(index, cancelled)) ?? {
                        ...input,
                        snapshot: (capturedSnapshot ??= state.options.getLaunchSnapshot()),
                    };
                    if (current.task.id !== input.task.id ||
                        current.task.prompt !== input.task.prompt ||
                        JSON.stringify(current.task.worktree) !==
                            JSON.stringify(input.task.worktree))
                        throw new Error("Pi attempt preparation changed the invocation identity, prompt or worktree.");
                    // A candidate was authorized at planning time; the scope may have
                    // changed since. Re-check it against this attempt's snapshot, which
                    // prepareAttempt rebuilds from the live parent for every attempt.
                    assertModelInScope(plan.model, current.snapshot.modelRegistry);
                    parent ??= current.snapshot.parent.sessionId;
                    const owner = adapter(current.snapshot);
                    spawning = true;
                    const handle = await owner.spawn({
                        acquisitionSignal: cancelled,
                        name: input.task.name,
                        task: input.task.prompt,
                        cwd: current.task.cwd,
                        sessionId: current.snapshot.parent.sessionId,
                        role: current.role,
                        env: current.task.env,
                        session: current.task.session,
                        behavior: current.task.behavior,
                        tools: current.task.tools,
                        systemPrompt: current.resolved.agent
                            ? current.role.systemPrompt
                            : current.task.systemPrompt,
                        surface: input.surface,
                        worktreeRequest: input.task.worktree,
                        accept: input.task.accept,
                        runtime: { model: plan.model, thinking: plan.thinking },
                        resolvedLaunch: { ...current.resolved, runtimePlan: plan },
                        launchIdentity: {
                            ...current.identity,
                            id: publicId ?? current.identity.id,
                            logicalId: logicalId ?? current.identity.logicalId,
                        },
                    });
                    publicId = handle.id;
                    logicalId ??= current.identity.logicalId;
                    return acquired(input.task, parent, owner, handle, attempts, failures, spawned, input.warning, undefined, acquisition.suppressed);
                }
                catch (error) {
                    if (cancelled.aborted && !spawning) {
                        // Cancelled while preparing: the candidate neither launched nor failed.
                        attempts.pop();
                        throw error;
                    }
                    failures.push({
                        model: plan.model,
                        error: error instanceof Error ? error.message : String(error),
                    });
                    throw error;
                }
                finally {
                    state.pending.delete(acquisition);
                }
            },
        };
    }
    const io = createPiPersistentIO(state);
    const facade = {
        ...state.kernel,
        async handoffWorktree(input) {
            assertManagedWorktreesSupported(state.options.platform);
            // This is a long-lived interactive handoff, deliberately outside the
            // watched kernel: no task reservation, acquire, producer or watcher.
            const snapshot = input.snapshot;
            const result = await launchPiWorktreeHandoff({
                kind: "fresh",
                name: input.name,
                task: input.task,
                cwd: snapshot.parent.cwd,
                worktree: { branch: input.branch },
                handoff: { leafId: input.leafId },
                parent: { ...snapshot.parent },
                runtimePlan: input.runtimePlan,
                modelScope: snapshot.modelRegistry.scope,
                behavior: {
                    deniedTools: [],
                    autoExit: false,
                    interactive: true,
                    sessionMode: "standalone",
                },
            }, launchOperations(snapshot));
            return { record: result.running, focusError: result.focusError };
        },
        createWorktreeCleanupOperations: (input) => {
            assertManagedWorktreesSupported(state.options.platform);
            if (state.infrastructure.surfaceProvider.nativeExecution)
                throw new Error("Managed worktree cleanup is not supported by Herdr Core");
            return createWorktreeCleanupOperations(state.infrastructure.surfaceProvider, input);
        },
        managedWorktreeRefusal: () => managedWorktreeRefusal(state.options.platform),
        async spawnPi(input) {
            // Refuse before the kernel reserves the task or any attempt starts.
            if (input.task.worktree)
                assertManagedWorktreesSupported(state.options.platform);
            try {
                return await state.kernel.spawn(input.task, prepare(input));
            }
            finally {
                prune(input.task.id);
            }
        },
        resumePi: (input) => resumePi(input),
        async supervise(handle, task, signal) {
            try {
                return await state.kernel.supervise(handle, task, signal);
            }
            finally {
                prune(task.id);
            }
        },
        getRecord: (id) => live(id)?.record,
        getStarted: (id) => live(id)?.started,
        getCompleted: (id) => live(id)?.completed,
        getControlTaskId(publicId) {
            for (const [id, entry] of state.entries)
                if (live(id) && entry.record.id === publicId)
                    return id;
            return undefined;
        },
        suppress(id) {
            for (const acquisition of state.pending)
                if (acquisition.taskId === id)
                    acquisition.suppressed = true;
            const suppressed = live(id);
            const r = suppressed?.record;
            if (r)
                r.lifecycle = markDelivery(r.lifecycle, "suppressed");
            // Nothing renews an unsupervised run's marker; clear it now.
            suppressed?.marker?.retire();
            state.kernel.suppress(id);
            state.entries.delete(id);
        },
        async cancel(id) {
            // The kernel records the intent and projects every owner's cancel state
            // through onCancelState; a natural result taken first keeps its own.
            try {
                return await state.kernel.cancel(id);
            }
            finally {
                prune(id);
            }
        },
        async sendPersistent(id, text) {
            return state.options.persistent.send(record(id), text, io);
        },
        async stopPersistent(id, timeoutMs = 15_000) {
            return state.options.persistent.stop(record(id), timeoutMs, io);
        },
        async send(id, text) {
            const ack = await facade.sendPersistent(id, text);
            if ("error" in ack)
                throw new Error(ack.error);
        },
        availability: () => ({
            available: state.infrastructure.surfaceProvider.isAvailable(),
            setupHint: state.infrastructure.surfaceProvider.setupHint(),
        }),
        listWorktreeSurfaces: (opts) => state.infrastructure.surfaceProvider.listWorktreeSurfaces(opts),
        inspectProgress(id) {
            const r = record(id);
            let updatedAt;
            try {
                updatedAt = statSync(r.sessionFile).mtimeMs;
            }
            catch {
                /* unavailable */
            }
            return { ...inspectNoProgressSessionTail(r.sessionFile), updatedAt };
        },
        diagnostics: () => state.infrastructure.supervision.diagnostics(),
        async shutdown(reason) {
            if (!["reload", "new", "resume", "fork"].includes(reason ?? "")) {
                for (const id of new Set([
                    ...state.entries.keys(),
                    ...[...state.pending].map((a) => a.taskId),
                ]))
                    facade.suppress(id);
                state.infrastructure.supervision.close();
                // Suppression aborted their re-checks; finish what ignores SIGTERM.
                await terminateAcceptChecks(acceptChecks);
            }
        },
    };
    Object.defineProperty(facade, OWNER, { value: state });
    return facade;
}
//# sourceMappingURL=pi-run-session.js.map