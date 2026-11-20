import { isAcquisitionUncertainError, } from "../core/surface-provider.js";
import { defaultRetainSurface } from "./surface-retention.js";
const ABORT_MESSAGE = "Aborted while waiting for subagent to finish";
const CANCELLED_BEFORE_LAUNCH = "Subagent was cancelled before launch.";
const UNCERTAIN_RETRY_INITIAL_MS = 1_000;
const UNCERTAIN_RETRY_MAX_MS = 30_000;
// pi-herdr-agents extension
export function createRunSession(options) {
    const entries = new Map();
    // Identity only, never a historical owner/result registry.
    const consumed = new Set();
    const sessionBase = options.sessionIdPrefix ?? Date.now().toString(36);
    const retainSurface = options.retainSurface ?? defaultRetainSurface;
    const recheckMs = options.terminationRecheckMs ?? 2_000;
    function reserve(task) {
        if (entries.has(task.id) || consumed.has(task.id)) {
            throw new Error(`Task ID "${task.id}" is already reserved or consumed.`);
        }
        const entry = {
            task,
            persistent: false,
            nextCandidate: 0,
            attempts: [],
            controller: new AbortController(),
            cancelIntent: new AbortController(),
            suppressed: false,
            released: false,
            acquiring: false,
            settled: false,
            uncertainRetryDelayMs: UNCERTAIN_RETRY_INITIAL_MS,
        };
        entries.set(task.id, entry);
        return entry;
    }
    function resolveRole(task) {
        const role = options.roles.find((candidate) => candidate.name === task.role);
        if (!role)
            throw new Error(`Role "${task.role}" was not found.`);
        return role;
    }
    function wrap(handle) {
        const owner = { handle, adapter: options.adapter };
        const surfaceId = handle.surfaceId;
        const provider = options.surfaceProvider;
        if (surfaceId !== undefined && provider) {
            owner.closeTemporarySurface = async () => {
                await provider.closeSurface(surfaceId);
            };
        }
        return owner;
    }
    function defaultPreparation(task, role) {
        return {
            role,
            persistent: task.behavior?.persistent ?? role.defaults?.persistent ?? false,
            candidates: task.runtime
                ? [
                    { model: task.runtime.model, thinking: task.runtime.thinking },
                    ...(task.runtime.fallbacks ?? []),
                ]
                : [],
            spawnAttempt: async (spawnOptions, _index, cancelled) => wrap(await options.adapter.spawn({
                ...spawnOptions,
                acquisitionSignal: cancelled,
            })),
        };
    }
    function spawnOptions(entry, prepared, index) {
        const task = entry.task;
        const candidate = prepared.candidates[index];
        return {
            name: task.name,
            task: task.prompt,
            role: prepared.role,
            cwd: task.cwd,
            sessionId: `${sessionBase}-${task.id}`,
            env: options.env || task.env ? { ...options.env, ...task.env } : undefined,
            session: task.session,
            behavior: task.behavior,
            tools: task.tools,
            systemPrompt: task.systemPrompt,
            worktreeRequest: task.worktree,
            runtime: candidate
                ? { model: candidate.model, thinking: candidate.thinking }
                : undefined,
        };
    }
    function register(entry, owner) {
        consumed.add(entry.task.id);
        entry.attempts.push(owner);
        entry.active = owner;
    }
    function retire(entry) {
        if (entries.get(entry.task.id) === entry)
            entries.delete(entry.task.id);
        entry.active = undefined;
        entry.prepared = undefined;
        entry.attempts.length = 0;
        entry.producer = undefined;
    }
    function release(entry, result) {
        if (entry.released ||
            entry.task.worktree ||
            retainSurface(result, entry.task))
            return;
        entry.released = true;
        for (const attempt of entry.attempts) {
            const close = attempt.closeTemporarySurface;
            if (!close)
                continue;
            // Only the close's own capture survives retirement. No close round-trip
            // may delay process settlement or cause an unhandled rejection.
            try {
                void close.call(attempt).catch(() => { });
            }
            catch {
                /* best effort */
            }
        }
    }
    function suppressedBeforeSupervision(entry) {
        const owner = entry.active;
        if (!owner)
            return; // Pending acquisition still owns the reservation.
        try {
            release(entry, rejectedResult(owner.handle, new Error(ABORT_MESSAGE)));
        }
        finally {
            retire(entry);
        }
    }
    async function acquiredHook(entry, owner) {
        // Acquisition is already registered. Hook failure is explicitly recoverable,
        // not a launch failure and never an excuse to acquire another candidate.
        await options.hooks?.onSpawned?.(owner.handle, entry.task);
    }
    async function acquireNext(entry) {
        const prepared = entry.prepared;
        if (!prepared)
            throw new Error(`Task "${entry.task.id}" has no prepared launch.`);
        const failures = [];
        let uncertain;
        const count = Math.max(1, prepared.candidates.length);
        while (!entry.suppressed && !entry.cancel && entry.nextCandidate < count) {
            const index = entry.nextCandidate++;
            let owner;
            entry.acquiring = true;
            try {
                owner = await prepared.spawnAttempt(spawnOptions(entry, prepared, index), index, entry.cancelIntent.signal);
            }
            catch (error) {
                failures.push({
                    model: prepared.candidates[index]?.model ?? "adapter default",
                    error: errorText(error),
                });
                if (isAcquisitionUncertainError(error)) {
                    uncertain = error;
                    break;
                }
                continue;
            }
            finally {
                entry.acquiring = false;
            }
            // Even a suppressed or cancelled in-flight acquisition must transfer its
            // real owner; a cancelled one is terminated as soon as it is registered.
            register(entry, owner);
            terminateTransferred(entry);
            return { owner, failures, uncertain: undefined };
        }
        return { owner: undefined, failures, uncertain };
    }
    function notifyCancel(entry, state, owner = entry.active) {
        if (!owner)
            return;
        try {
            options.hooks?.onCancelState?.(owner.handle, entry.task, state);
        }
        catch {
            /* presentation only; never affects termination */
        }
    }
    function terminateTransferred(entry) {
        if (!entry.cancel)
            return;
        notifyCancel(entry, "requested");
        void terminate(entry);
    }
    // One owned kill at a time. Only a resolved kill confirms termination; only
    // then is the producer's wait aborted, so a failed kill leaves it supervised.
    function terminate(entry) {
        const state = entry.cancel;
        const owner = entry.active;
        if (!state || !owner || state.termination === "confirmed")
            return Promise.resolve();
        if (state.kill)
            return state.kill;
        const kill = (async () => {
            try {
                await owner.adapter.kill(owner.handle);
                markTerminated(entry, state);
            }
            catch (error) {
                state.termination = "unconfirmed";
                state.error = errorText(error);
            }
            finally {
                state.kill = undefined;
                notifyCancel(entry, state.termination, owner);
                wake(state);
                if (state.termination === "unconfirmed")
                    watchTermination(entry, state, owner);
            }
        })();
        state.kill = kill;
        return kill;
    }
    function markTerminated(entry, state) {
        state.termination = "confirmed";
        state.confirmedAt = Date.now();
        state.error = undefined;
        entry.uncertainRetryDelayMs = UNCERTAIN_RETRY_INITIAL_MS;
        entry.controller.abort();
    }
    // An unconfirmed kill is not the end of the evidence: the pane can close or
    // the process exit afterwards while nobody retries (a retained pane outlives
    // its Pi, and the producer makes only one kill of its own). The adapter is
    // asked, without any signal, whether the target is now gone; the same
    // confirmation then settles the run through its single producer.
    function watchTermination(entry, state, owner) {
        const observe = owner.adapter.confirmTerminated?.bind(owner.adapter);
        if (!observe || state.watching === owner)
            return;
        state.watching = owner;
        const live = () => state.watching === owner &&
            state.termination !== "confirmed" &&
            !entry.suppressed &&
            entry.active === owner &&
            entries.get(entry.task.id) === entry;
        void (async () => {
            try {
                while (live()) {
                    await pause(state, recheckMs);
                    // An owned kill in flight reaches its own verdict.
                    if (!live() || state.kill)
                        continue;
                    let gone = false;
                    try {
                        gone = await observe(owner.handle);
                    }
                    catch {
                        /* An unreadable target is unknown, never gone. */
                    }
                    if (!gone || !live() || state.kill)
                        continue;
                    markTerminated(entry, state);
                    notifyCancel(entry, "confirmed", owner);
                    wake(state);
                }
            }
            finally {
                if (state.watching === owner)
                    state.watching = undefined;
            }
        })();
    }
    // Resolves after the delay or at the next wake, whichever comes first. A
    // background observation never holds the process open.
    function pause(state, ms) {
        return new Promise((resolve) => {
            const done = () => {
                clearTimeout(timer);
                state.waiters.delete(done);
                resolve();
            };
            const timer = setTimeout(done, ms);
            timer.unref();
            state.waiters.add(done);
        });
    }
    function wake(state) {
        const waiters = [...state.waiters];
        state.waiters.clear();
        for (const resolve of waiters)
            resolve();
    }
    // The producer settles a cancelled run only after confirmed termination. It
    // makes one kill itself when its wait ended without one (late acquisition or
    // natural exit evidence); otherwise it waits for an operator retry or shutdown.
    async function confirmTermination(entry) {
        const state = entry.cancel;
        let attempted = false;
        for (;;) {
            if (state.termination === "confirmed" || entry.suppressed)
                return;
            if (state.kill)
                await state.kill;
            else if (!attempted) {
                attempted = true;
                await terminate(entry);
            }
            else
                await new Promise((resolve) => state.waiters.add(resolve));
        }
    }
    function refresh(entry, at) {
        const owner = entry.active;
        const observation = owner?.observe?.(at);
        if (owner && observation)
            options.hooks?.onObserved?.(owner.handle, observation.projection, observation);
        return observation;
    }
    async function deliver(entry, result) {
        try {
            if (!entry.suppressed)
                await options.hooks?.onSettled?.(result, entry.task);
            release(entry, result);
            return result;
        }
        finally {
            // A rejected send retains panes but not full runtime ownership.
            retire(entry);
        }
    }
    function retryable(entry, owner, result) {
        const prepared = entry.prepared;
        return (!entry.suppressed &&
            !owner.handle.launchFailure &&
            !(owner.persistent ?? entry.persistent) &&
            result.evidence?.errorMessage !== undefined &&
            !!prepared &&
            entry.nextCandidate < prepared.candidates.length);
    }
    function waitForUncertainRetry(entry) {
        const signal = entry.controller.signal;
        if (signal.aborted)
            return Promise.resolve();
        const delay = entry.uncertainRetryDelayMs;
        entry.uncertainRetryDelayMs = Math.min(delay * 2, UNCERTAIN_RETRY_MAX_MS);
        return new Promise((resolve) => {
            const finish = () => {
                clearTimeout(timer);
                signal.removeEventListener("abort", finish);
                resolve();
            };
            const timer = setTimeout(finish, delay);
            signal.addEventListener("abort", finish, { once: true });
        });
    }
    async function produce(entry) {
        for (;;) {
            const owner = entry.active;
            if (!owner)
                throw new Error(`Task "${entry.task.id}" has no active owner.`);
            let result;
            try {
                const evidence = await owner.adapter.awaitCompletion(owner.handle, entry.controller.signal);
                entry.uncertainRetryDelayMs = UNCERTAIN_RETRY_INITIAL_MS;
                result = evidenceResult(owner.handle, evidence);
            }
            catch (error) {
                if (entry.cancel &&
                    entry.cancel.termination !== "confirmed" &&
                    !entry.suppressed) {
                    await waitForUncertainRetry(entry);
                    if (!entry.controller.signal.aborted)
                        continue;
                }
                if (owner.handle.launchFailure && !entry.cancel && !entry.suppressed) {
                    // A broken watcher is not exit evidence for an uncertain launch.
                    // Retain this same owner and retry supervision, never acquisition.
                    try {
                        await owner.adapter.kill(owner.handle);
                        entry.uncertainRetryDelayMs = UNCERTAIN_RETRY_INITIAL_MS;
                    }
                    catch {
                        await waitForUncertainRetry(entry);
                        // Suppression or confirmed cancel ends the wait without another probe.
                        if (!entry.controller.signal.aborted)
                            continue;
                    }
                }
                result = rejectedResult(owner.handle, error);
            }
            // Settle point: intent recorded before this synchronous check wins, and a
            // natural result that cannot start a fallback makes later cancels too late.
            if (entry.cancel) {
                await confirmTermination(entry);
                result = cancelledResult(owner.handle, entry.cancel);
            }
            else if (!retryable(entry, owner, result))
                entry.settled = true;
            let reopened = false;
            let interruption;
            const control = {
                async cancellable(work) {
                    // Only a natural result that already took the settle point reopens it.
                    if (!entry.settled || entry.cancel || entry.suppressed)
                        return work(entry.controller.signal);
                    reopened = true;
                    entry.settled = false;
                    try {
                        return await work(entry.controller.signal);
                    }
                    finally {
                        if (!entry.cancel)
                            entry.settled = true;
                        // A cancel recorded in the window wins once termination is
                        // confirmed, even if the work finished on its own (ADR-0017).
                        else if (!entry.suppressed)
                            await confirmTermination(entry);
                        if (entry.suppressed)
                            interruption = "suppressed";
                        else if (entry.cancel)
                            interruption = "cancelled";
                    }
                },
                interruption: () => interruption,
            };
            try {
                if (owner.finalize)
                    result = await owner.finalize(result, entry.task, control);
            }
            catch (error) {
                retire(entry);
                throw error;
            }
            if (reopened && entry.cancel && !entry.suppressed) {
                // Cancel intent recorded during the reopened window wins (ADR-0014).
                await confirmTermination(entry);
                result = cancelledResult(owner.handle, entry.cancel);
            }
            // A cancel recorded while finalizing a retryable error lands below: the
            // acquisition gate starts nothing and the settled owner is terminated.
            if (retryable(entry, owner, result)) {
                entry.settled = false;
                const next = await acquireNext(entry);
                if (next.owner && !entry.suppressed) {
                    try {
                        await acquiredHook(entry, next.owner);
                    }
                    catch (error) {
                        if (!entry.suppressed && !entry.cancel)
                            throw error;
                    }
                    // A cancelled transferred owner is already being terminated; its
                    // own wait and finalization produce the single cancelled result.
                    if (!entry.suppressed)
                        continue;
                }
                if (entry.cancel && !entry.suppressed) {
                    // Cancelled before or while acquiring and nothing was transferred: the
                    // settled previous attempt is still owned; terminate it, then deliver.
                    await confirmTermination(entry);
                    return deliver(entry, cancelledResult(owner.handle, entry.cancel));
                }
                if (!entry.suppressed && next.failures.length && result.evidence) {
                    const message = `${result.evidence.errorMessage}\n\nFallback launch failures: ${formatFailures(next.failures)}`;
                    result = {
                        ...result,
                        error: message,
                        evidence: { ...result.evidence, errorMessage: message },
                    };
                }
                // Every fallback failed: this natural failure is now terminal, so a
                // cancel during its delivery is too late, never a second outcome.
                entry.settled = true;
            }
            return deliver(entry, result);
        }
    }
    function active(taskId) {
        const owner = entries.get(taskId)?.active;
        if (!owner)
            throw new Error(`Task "${taskId}" has no active owner${consumed.has(taskId) ? " (retired/consumed)" : ""}.`);
        return owner;
    }
    return {
        async spawn(task, preparedOverride) {
            const entry = reserve(task);
            try {
                const prepared = preparedOverride ??
                    (options.operations
                        ? await options.operations.prepare(task, resolveRole(task))
                        : defaultPreparation(task, resolveRole(task)));
                if (entry.suppressed)
                    throw new Error(ABORT_MESSAGE);
                if (entry.cancel)
                    throw new Error(CANCELLED_BEFORE_LAUNCH);
                if (task.worktree && prepared.candidates.length > 1) {
                    throw new Error("Model fallbacks are not supported for worktree subagents.");
                }
                entry.prepared = prepared;
                entry.persistent = prepared.persistent;
                const acquired = await acquireNext(entry);
                if (entry.suppressed) {
                    suppressedBeforeSupervision(entry);
                    throw new Error(ABORT_MESSAGE);
                }
                if (!acquired.owner) {
                    if (acquired.uncertain)
                        throw acquired.uncertain;
                    if (entry.cancel)
                        throw new Error(CANCELLED_BEFORE_LAUNCH);
                    throw new Error(`Subagent could not launch with any configured model. Attempted: ${prepared.candidates.map((candidate) => candidate.model).join(", ")}. ${formatFailures(acquired.failures)}`);
                }
                await acquiredHook(entry, acquired.owner);
                if (entry.suppressed)
                    throw new Error(ABORT_MESSAGE);
                return acquired.owner.handle;
            }
            catch (error) {
                if (!consumed.has(task.id))
                    retire(entry);
                throw error;
            }
        },
        async resume({ task, ...resumeOptions }) {
            const entry = reserve(task);
            try {
                entry.persistent =
                    task.behavior?.persistent ??
                        options.roles.find((role) => role.name === task.role)?.defaults
                            ?.persistent ??
                        false;
                entry.acquiring = true;
                resumeOptions.acquisitionSignal = entry.cancelIntent.signal;
                let owner;
                try {
                    owner = options.operations?.resume
                        ? await options.operations.resume(resumeOptions, task)
                        : wrap(await options.adapter.resume(resumeOptions));
                }
                finally {
                    entry.acquiring = false;
                }
                register(entry, owner);
                terminateTransferred(entry);
                if (entry.suppressed) {
                    suppressedBeforeSupervision(entry);
                    throw new Error(ABORT_MESSAGE);
                }
                await acquiredHook(entry, owner);
                if (entry.suppressed)
                    throw new Error(ABORT_MESSAGE);
                return owner.handle;
            }
            catch (error) {
                if (!consumed.has(task.id))
                    retire(entry);
                throw error;
            }
        },
        async supervise(handle, task, signal) {
            const entry = entries.get(task.id);
            if (!entry)
                throw new Error(`Task "${task.id}" ${consumed.has(task.id) ? "is retired/consumed" : "was not found"}.`);
            if (entry.task !== task || entry.active?.handle !== handle) {
                throw new Error(`Task "${task.id}" does not match this active handle/owner.`);
            }
            if (signal?.aborted)
                throw new Error(ABORT_MESSAGE);
            let producer = entry.producer;
            if (!producer) {
                // Publish and observe before either observation or adapter callbacks can
                // suppress/retire the entry or synchronously rejoin this shared outcome.
                let resolveProducer;
                let rejectProducer;
                producer = new Promise((resolve, reject) => {
                    resolveProducer = resolve;
                    rejectProducer = reject;
                });
                entry.producer = producer;
                // Keep the owned producer observed even if startup throws or all callers cancel.
                void producer
                    .catch(() => { })
                    .finally(() => {
                    if (entry.producer === producer)
                        entry.producer = undefined;
                });
                try {
                    refresh(entry, Date.now());
                }
                catch (error) {
                    // No adapter wait has started. Reject reentrant joins with the original
                    // error; only unsuppressed ownership remains explicitly recoverable.
                    entry.producer = undefined;
                    rejectProducer(error);
                    if (entry.suppressed) {
                        try {
                            suppressedBeforeSupervision(entry);
                        }
                        catch {
                            // Retention failure must not mask the callback error. The helper
                            // retires ownership in its finally even when release throws.
                        }
                    }
                    throw error;
                }
                // Start synchronously: microtask deferral changes evidence-vs-abort ordering.
                void produce(entry).then(resolveProducer, rejectProducer);
            }
            else {
                refresh(entry, Date.now());
            }
            // Callbacks may already have retired entry.producer; never reread that slot.
            return join(producer, signal);
        },
        getHandle: (taskId) => entries.get(taskId)?.active?.handle,
        getTask: (taskId) => entries.get(taskId)?.task,
        async send(taskId, text) {
            const owner = active(taskId);
            await owner.adapter.sendInput(owner.handle, text);
        },
        async kill(taskId) {
            const owner = active(taskId);
            await owner.adapter.kill(owner.handle);
        },
        async interrupt(taskId) {
            const owner = active(taskId);
            await owner.adapter.interrupt(owner.handle);
        },
        observe(taskId, at = Date.now()) {
            const entry = entries.get(taskId);
            return entry ? refresh(entry, at) : undefined;
        },
        suppress(taskId) {
            const entry = entries.get(taskId);
            if (!entry || entry.suppressed)
                return;
            entry.suppressed = true;
            entry.controller.abort();
            if (entry.cancel)
                wake(entry.cancel);
            if (!entry.producer)
                suppressedBeforeSupervision(entry);
        },
        async cancel(taskId) {
            const entry = entries.get(taskId);
            if (!entry) {
                if (consumed.has(taskId))
                    return { status: "already-terminal" };
                throw new Error(`Task "${taskId}" was not found.`);
            }
            if (entry.active?.persistent ?? entry.persistent)
                throw new Error(`Task "${taskId}" is persistent; use its graceful stop instead of cancel.`);
            if (entry.suppressed || (entry.settled && !entry.cancel))
                return { status: "already-terminal" };
            const repeated = !!entry.cancel;
            // Terminal intent is recorded synchronously, before any abort, kill or await.
            const state = (entry.cancel ??= {
                requestedAt: Date.now(),
                termination: "unconfirmed",
                waiters: new Set(),
            });
            entry.cancelIntent.abort();
            if (state.termination !== "confirmed")
                notifyCancel(entry, "requested");
            const report = (status) => {
                const value = { status, requestedAt: state.requestedAt };
                if (status === "unconfirmed" && state.error)
                    value.error = state.error;
                if (repeated)
                    value.repeated = true;
                return value;
            };
            // No owner yet: the in-flight acquisition transfers it, then it is killed.
            if (!entry.active || entry.acquiring)
                return report("requested");
            await terminate(entry);
            return report(state.termination);
        },
    };
}
function errorText(cause) {
    return cause instanceof Error ? cause.message : String(cause);
}
function formatFailures(failures) {
    return failures.map(({ model, error }) => `${model}: ${error}`).join("; ");
}
function evidenceResult(handle, evidence) {
    return {
        handle,
        outcome: evidence.reason === "ping"
            ? "help"
            : evidence.reason === "error" || evidence.exitCode !== 0
                ? "failed"
                : "completed",
        exitCode: evidence.exitCode,
        error: evidence.errorMessage,
        output: evidence.finalMessage?.text,
        durationMs: Date.now() - handle.startedAt,
        evidence,
    };
}
function cancelledResult(handle, state) {
    const cancellation = {
        requestedAt: state.requestedAt,
        termination: state.termination,
    };
    if (state.confirmedAt !== undefined)
        cancellation.confirmedAt = state.confirmedAt;
    if (state.error !== undefined)
        cancellation.error = state.error;
    return {
        handle,
        outcome: "killed",
        error: "Cancelled by operator",
        durationMs: Date.now() - handle.startedAt,
        cancellation,
    };
}
function rejectedResult(handle, cause) {
    const message = errorText(cause);
    return {
        handle,
        outcome: /abort/i.test(message) ? "killed" : "failed",
        error: message,
        durationMs: Date.now() - handle.startedAt,
    };
}
function join(producer, signal) {
    if (!signal)
        return producer;
    return new Promise((resolve, reject) => {
        const onAbort = () => {
            signal.removeEventListener("abort", onAbort);
            reject(new Error(ABORT_MESSAGE));
        };
        signal.addEventListener("abort", onAbort, { once: true });
        if (signal.aborted)
            onAbort();
        void producer.then((result) => {
            signal.removeEventListener("abort", onAbort);
            resolve(result);
        }, (cause) => {
            signal.removeEventListener("abort", onAbort);
            reject(cause);
        });
    });
}
//# sourceMappingURL=run-session.js.map