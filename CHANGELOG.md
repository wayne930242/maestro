# Changelog

## Unreleased

### Tracked-run snapshot probe

- New synchronous event-bus probe `pi-herdr-agents:runs:v1`: another
  in-process extension emits `{}` and the run owner sets
  `snapshot = { version: 1, runs: [{ id, name, agent?, persistent, delivery }] }`
  with the runs it tracks now (no delivered history). No listener is needed
  by any existing behaviour. See
  [docs/tools.md](docs/tools.md#tracked-run-snapshot-pi-herdr-agentsrunsv1).
- `maestro/core/tracked-runs.ts` (new) holds the projection;
  `hasUndeliveredChildren`, the auto-exit guard for children that launch
  children, now reads it. Its behaviour and tests are unchanged.

### Bound checks and failure and cancel hand-offs (P3-10)

Opt-in by explicit composition (`WorkerRunChecks` as a worker parent's run
owner operations and hooks); terminal hosts and the public tools are
unchanged. See [docs/worker-provider.md](docs/worker-provider.md#bound-checks-and-hand-offs-p3-10).

- The vendored `@nublai/pi-worker-client` is now built from pi-worker
  `b6e5a3c` (`executions.interrupt` on the parent channel, `artifacts.inspect`,
  owner Git that never trusts a child's index); the real-B2 lane verifies that
  checkout.
- The V1 bound check (`maestro/adapters/worker/bound-check.ts`): the child's
  termination is confirmed for the generation that ran, then
  `artifacts.inspect` at the worker's saved launch pin must show the issued
  base as an ancestor, HEAD on the issued branch at its commit, the child's
  claimed commit (mandatory) as that commit, and a clean checkout
  (the worker's `.piw-agent/` and `.piw-worker/` are listed by name). The
  subject (commit, tree, base, branch, root, pin identity) is durable before
  the approved command runs with Maestro's parent-side accept runner, never
  in the child's checkout: in a fresh, byte-exact copy of the subject tree
  (`maestro/adapters/worker/materialize.ts`), read from the repository's
  object database with `git cat-file --batch` (no filters, attributes,
  hooks, replace objects or lazy fetch) with every object's hash recomputed
  by Maestro and the copy's own tree recomputed and required to equal the
  inspected tree; a missing or corrupt object, a gitlink, a symbolic link,
  an unsupported mode or name, or a copy over its entry, byte, depth, path
  or time caps is refused with a typed reason and nothing runs. The child
  checkout's clean status is a recorded hygiene fact (a dirty one still gets
  no verdict). The command runs in a synthetic environment (an explicit allowlist: `PATH`, the
  locale, declared variables, `HOME` and `TMPDIR` in the check's scratch),
  and must read the same after it. Otherwise there is no accepted verdict:
  `error` with the reason, and the command does not run when nothing was
  bound. A cancel during the command or the inspection after it is `skipped
  (cancelled)`, its own outcome; a cancelled run never carries a bound
  verdict. Only a stop B2 reports `outcome_unknown` is repeated (at most
  three stops).
- The outcome store keeps the verdict (command hash, exit or result,
  environment, termination), both subjects and the run's hand-off facts
  (commands and their outcomes, reports, the child's and the parent's state,
  the durable cancel intent, the parent's fence and `owner-reconciliation`).
  A run interrupted by a restart is handed off once, against its saved check
  subject, by `handOffInterrupted`; nothing is re-run.
- Worker children declare the bwrap profile of their slot (`filesystem`
  option, default `bwrap`), so the worker saves the launch's Git pin; the
  create is the body a parent channel records. A result claim may name its
  commit. Interactive and self-spawning children, persistent specialists,
  model fallback lists and a worktree of the child's own (a branch no
  prepared slot has; a named slot is never replaced by another) are refused
  before acquisition. `artifacts.inspect` joins the parent grant profile.
- A run owner's `persistCancelIntent` hook (shared `RunSession`, absent for
  terminal hosts) gates every kill a cancel leads to: the worker run's cancel
  intent is durable in its launch manifest first, and when the write fails
  no stop is sent and the cancel reports the failure.
- The ExecProvider conformance kit's unobserved-stop case repeats a second
  stop only after an unconfirmed report for a sent or maybe-sent stop
  (maestro#11).

### Receipt-backed parent admission and recovery (P3-9)

Opt-in by explicit composition; without `parentAdmission`, delivery, the
outcome store's behaviour for terminal hosts and the public tools are
unchanged. See [docs/worker-provider.md](docs/worker-provider.md#parent-admission-p3-9).

- `AdmissionOutbox` (`maestro/runtime/admission-outbox.ts`) owns delivery of
  committed outcomes, oldest first, through a `ParentAdmission` port
  (`maestro/core/parent-admission.ts`):
  - each attempt's command ID and request identity are durable with
    `dispatching` before its transport;
  - only a matching receipt that says the input was admitted is `admitted`
    (`receipt` evidence); a restart reads every uncertain attempt back by its
    receipt before sending anything new, so an admission whose local ack was
    lost is recorded, never resent;
  - a busy, fenced, rebound, stopped or unreachable parent makes the outcome
    wait in the outbox (busy and unreachable without a write; the others
    durably `blocked`); a proven refusal retries under a new command ID only
    when its cause can clear;
  - an unknown outcome (lost reply, `outcome_unknown`, missing, expired or
    scope-denied receipt, a receipt for another request) stays `uncertain`
    and is surfaced through `attention()`; only the owner's `abandon` ends it.
    No fence is cleared and no parent is relaunched or replaced.
- `WorkerParentAdmission` (`maestro/adapters/worker/parent-admission.ts`)
  delivers to the parent worker as one `sessions.prompt {if_busy: reject}` to
  its exact worker, epoch and session (`workerParentIdentity`, the store's
  parent identity; another generation or session needs explicit adoption).
  The message is a versioned envelope (`maestro-outcome/v1`) persisted with
  the outcome. `WorkerExecutionProvider.parentAdmission()` builds it over the
  provider's own client; the worker capability is now `parentAdmission:
  "receipt"`.
- Help requests are their own outcomes (`kind: help`, keyed by the report's
  command ID, not closing the run), committed in one store record together
  with the provider Observer's state (`workerObserverPersistence`), so a
  restart resumes the Observer from exactly what was saved
  (`resumeObservation()`). A cold first snapshot retains the owned help
  requests it counts as seen in the same record, so help reported before the
  Observer's first snapshot (or with no saved state) is not lost.
- `RunSession` option `parentAdmission` (needs `outcomeStore`): the committed
  outcome carries its envelope and a delivery ID stable across commit
  retries and is handed to the outbox; `onSettled` is then only a settled
  notification.
- `OutcomeStore`: `dispatch(id, {commandId, request})` records the attempt's
  identity; a settlement may carry its receipt identity; an `uncertain`
  delivery may become `blocked` only with the refused receipt that proves it
  began nothing, and a new attempt never reuses an earlier command ID.
- Tests: outbox unit cases on the simulated-durability filesystem (attempt
  durable before send, waits, refusals, unknowns, restart reads, ordering,
  serialized submits); `npm run test:worker-b2` adds 23 real-supervisor cases:
  the O1 crash cuts (before and after the commit, after the dispatch record,
  after B2 admission before the local ack, after the ack, inside compaction
  before and after the snapshot rename) with the Maestro process SIGKILLed
  and restarted, busy and fenced parents, lost replies (worker and transport),
  B2 restarts, mismatched and non-admitting receipts, wrong, rebound, stopped
  and unreachable parents, expired and scope-denied receipts, and help
  requests across a restart, before the Observer's first snapshot and with
  no saved Observer state.
- Conformance kit: an optional `ExecProviderFixture.unobserveNextStop`. A
  provider whose host may end an execution without observing it at once
  (B2 confirms a stop only once the child's leader process is proven gone;
  under load a zombie leader with a thread still exiting is not, and the
  stop is `outcome_unknown`) declares it; the suite checks that such a stop
  is an unconfirmed report and that a later stop confirms, and repeats its
  other stops instead of assuming the first confirms. A case sends one
  execution at most three stops in all, and repeats a stop only after the
  provider returned an unconfirmed report for a sent (or maybe sent) stop;
  through the adapter, only when that call's one `provider.stop` returned
  such a report and the adapter threw its error. A stop rejection or any
  other adapter error fails the case at once. Fixtures without the hook are
  checked as before. Unit cases run the suite over a hooked fake and check
  that it rejects the mutants (a rejected stop, an adapter error instead of
  or after a stop, a stop that never confirms). The worker B2 tests repeat
  only a stop whose B2 receipt is `outcome_unknown`.

### Worker execution provider (P3-7)

This is opt-in by explicit host composition, with no flags. Terminal hosts,
package exports and the public tools are unchanged. See
[docs/worker-provider.md](docs/worker-provider.md).

- `WorkerExecutionProvider` (`maestro/adapters/worker/`) implements
  `ExecProvider` over pi-worker B2 through the exact
  `@nublai/pi-worker-client` tarball, vendored from pi-worker `ce10eec` as a
  development dependency until P3-11.
  - Launch: unsupported requests are refused before acquisition. The provider
    then reads the parent's binding and running execution, durably claims an
    owner-prepared slot and writes one acquisition manifest per launch, then
    sends `workers.create {parent, launch_spec}`. The initial
    `sessions.prompt` is a separate command.
  - Observe and read: the Observer supplies wake-ups, `workers.get` supplies
    presence, and `history.page` supplies output.
  - Interrupt and stop go through their receipts. Only the named epoch's
    observed termination confirms a stop.
  - Every mutation's UUIDv7 command ID and request hash are persisted before
    transport. A lost reply gets one receipt read. Uncertainty is kept and
    never retried; an uncertain create keeps its manifest and slot.
  - A store that fails after a command was sent is never a plain rejection:
    the launch returns the acquired worker with `launchFailure` (or rejects
    with `AcquisitionUncertainError` when no worker is named), a later prompt
    or interrupt rejects with `WorkerCommandUncertain`, and a stop reports
    unconfirmed. Nothing more is sent; the command, manifest and slot stay.
  - The initial prompt (`initialPrompt`) is prepared before acquisition, so
    a throwing callback acquires nothing; any other failure after
    `workers.create` returns the acquired worker with `launchFailure`.
  - The role identity is the initial prompt's preamble, accepted as interim
    append semantics; a request to replace the system prompt is refused
    before acquisition.
- Owner-prepared slots (`WorkerSlotPool`, root decision Q3): locked linked
  worktrees of the parent's repository at `PARENT/.piw-slots/<name>`, checked
  with plain reads, so the parent makes no Git administrative writes.
  Exhausted or mismatched slots are refused before `workers.create` (only
  the `hello` and parent `workers.get` reads come first). Claims live
  outside every slot, reached through real directories only (no symbolic link
  in the claims path).
- FD reporter (`fd-report.ts`): the leaf writes its report to FD 3, never to
  B2. Its import closure is `node:fs` only, and `check:boundaries` enforces
  that for the source and the emitted file. The provider transcribes the first
  result claim into the run's completion record; a claim is never proof. A
  summary that cannot fit, not even empty, is left out rather than looping.
- Grant profile (`grant-profile.ts`): the provider's exact methods plus
  `children.report`. It contains no `*`, no owner reconciliation, and no
  steering or follow-up.
- Tests:
  - Unit lane: the reporter and its authority boundary, slots, manifests and
    the grant closure.
  - `npm run test:worker-b2`: the ExecProvider conformance suite (with its
    adapter-boundary cases) and provider tests, against pi-worker's real
    supervisor and B2 server from a pinned, built checkout
    (`MAESTRO_PI_WORKER_CHECKOUT`). It refuses a checkout at another commit,
    with local changes, or whose build is not what that commit compiles to.
- Provenance: five new files.

### Checked-outcome outbox (P3-8)

Opt-in. Without an outcome store nothing changes for current hosts: same
messages, retirement, surface release and audit ledger (a regression test
compares the parent messages, ledger and surfaces with and without a store).

- `OutcomeStore` (`@nubl/maestro/core/outcome-store`): the injected outbox a
  run owner commits to. Attempt and check-start records; one record per
  checked outcome (bounded text with the full text's digest, verdict, subject,
  cancellation and host facts, optional exact envelope) with its `pending`
  delivery; delivery states `pending -> dispatching -> admitted`, or
  `uncertain`, `blocked`, `suppressed`. `uncertain` is never dispatched again.
  Deduplication by parent, task, generation, attempt, kind and source report;
  only identical content deduplicates (verdict, subject, envelope, text,
  cancellation and facts included); different content under the same key is a
  `conflict`. A help request never takes the result's slot. A batch saves outcomes and an
  opaque observer state (the pi-worker client observer's persisted state) in
  one record.
- `FileOutcomeStore` (`@nubl/maestro/runtime/file-outcome-store`): one writer
  per directory. The lock is a Unix-domain socket listening at
  `writer.lock`: the OS stops it listening when its process dies, so a live
  holder refuses an open from any process (another PID namespace included)
  and a dead one is taken over (moved aside only while the name is still the
  refused socket, by inode, so a lock another opener just recovered is never
  moved); a writer whose lock was removed or replaced stops writing and
  compacting. The store directory must be on local storage
  (Linux refuses known network, cluster and FUSE filesystems, local FUSE
  included; Windows is refused). A versioned and checksummed journal fsynced
  per record; a new store directory is fsynced into its parent before its
  first record; a bad last line cut on open (a torn append, or damage to the
  last acknowledged record, which is then lost; earlier damage, a sequence
  gap or another version refuses), and atomic snapshot compaction (fsynced
  rename before the journal is truncated). Durability is claimed for POSIX
  filesystems.
  Directory 0700, files 0600. A store belongs to one parent; another parent
  must adopt it explicitly. On open, a delivery left `dispatching` becomes
  `uncertain`, and runs with attempts but no outcome are reported interrupted.
  `terminalOutcomeStoreDir` places a terminal parent's store under
  `herdr-agents/outcome-store/`.
- `createRunSession({ outcomeStore })` and
  `createDefaultRunSession({ outcomeStore })`: each attempt (including a
  resume) is recorded before acquisition; `FinalizeControl.recordCheck`
  records a check's subject before the parent re-check runs; the finalized
  result is committed before delivery, `dispatching` is durable before
  `onSettled`, and the result then settles `admitted` (process-local
  evidence), `suppressed` or, if the send rejects, `uncertain`. A failed
  commit keeps the run owned, undelivered and its surfaces retained; the next
  `supervise` retries the commit, never the check. A check runs only after its
  subject is durable: a failed check-start record stops it. Suppression
  (shutdown) sends nothing. A finalized result, during its commit or its
  dispatch mark included, is committed and then withdrawn (`suppressed`);
  that includes a failure without completion evidence, such as a failed
  completion wait or a result the finalizer normalized to a failure. The
  withdrawal record is best effort: if it is lost, the committed outcome
  recovers as pending, or `uncertain` after its dispatch mark. A run's
  attempts are closed without an outcome only when it ends with no result:
  suppression ended its completion wait before it observed one (a recorded
  cancel is a result and is committed, withdrawn), it was suppressed before
  supervision, or it never launched. Interrupted verification, a failed
  finalization or a result that could not be saved leave the run open as
  recovery evidence. New hook
  `describeOutcome`; Pi supplies the summary or help text, verdict, worktree
  subject and runtime facts. A reload must keep the live owner's store.
- Not yet: worker parent admission, receipts and recovery delivery (P3-9).

### ExecProvider seam (P3-4)

No behaviour change for Herdr or Herdr Core hosts: same tools, schemas,
error text, lifecycle, cancel and fallback.

- `ExecProvider` (`@nubl/maestro/core/exec-provider`): where one run executes.
  `launch`, `inspect`/`observe`, `read`, `prompt`, `interrupt`, `stop` and
  `reconcile`, with explicit capabilities (resume, fork, persistent, shared
  checkout, worktree, caller surface, execution exit and parent admission).
  Handles carry the provider's opaque reference and capabilities; a surface ID
  only when the provider really hosts one. `stop` reports whether the request
  was sent separately from whether termination is confirmed.
- `PiHarnessAdapter` sends every execution effect through one provider. The
  existing Herdr/Core execution is `TerminalExecProvider`
  (`@nubl/maestro/adapters/pi/terminal-exec-provider`), still the default when
  only a surface is supplied; its stop logic moved there unchanged. A request
  that needs a capability the provider lacks is refused before any
  acquisition. Herdr Core keeps its existing refusal text for managed
  worktrees and supplied panes. The run owner (`RunSession`) is unchanged.
- The adapter keeps a provider's top-level `launchFailure` on the owned
  attempt: an acquired launch with an uncertain dispatch stays owned, is never
  retried with a fallback model and never completes as `done`. It passes the
  acquisition signal to `launch` as the seam's control argument.
- Completion presence and wake-ups come from the provider: the optional
  `ExecProvider.supervise` (terminal: the existing batched pane and
  session-file supervision, now passed to `TerminalExecProvider` as
  `supervision`), else `observeSupervision` over `observe`. While that
  observation stays open with no new snapshot, `observeSupervision` still
  wakes each second, so a quiet push provider's run completes on its local
  evidence or native exit. The adapter's
  `supervision` option is terminal composition, now optional; an `exec`
  provider supervises its own runs.
- `PiExecution` is Pi's shared execution record: the terminal-only fields
  (pane, pane ownership, launch script) are optional, so a provider without
  panes invents none. `PiHarnessAdapter` is generic over it, defaulting to the
  terminal's `PiRunningChild`.
- `@nubl/maestro/testing` adds `FakeExecProvider` and
  `registerExecProviderConformance`. The suite also drives the shared adapter
  when a fixture composes one (`ExecAdapterBoundary`): refusal before
  acquisition, aborted acquisition, the handle's surface and opaque
  reference, read/stop and unconfirmed stops, uncertain launches, and
  completion through `awaitCompletion` when a fixture can record evidence
  (`finish`). The terminal fixtures compose the adapter as the run session
  does, with its batched supervision coordinator. Fixture
  `blockStop` now returns the request state the blocked stop must report.
  The fake, a pane-less Pi fake (full and limited) and both terminal variants
  pass it.
- Terminal parent admission is declared `best-effort`: a host message without
  receipts or deduplication.

### Early-exit relay

Docs and tests only; no behaviour change.

- Documented a limit of the early-exit relay's masking. The relay cannot learn
  the terminal width, so it joins a row as wide as the widest row to the next
  row before masking. An ordinary word glued to a credential-shaped run across
  that join is masked with it: a long error that did not wrap, followed by
  `OPENAI_API_KEY=<key>`, is relayed as "status must be an [redacted]" (seen in
  giuseppecrj/pi-herdr-agents#150). The rest of the error and the masking of
  the key are unaffected. Showing the word instead (nublai/maestro#4) would also
  show a word-like edge of a real wrapped credential, so 0.1.2's behaviour
  stays.
- The masking tests now flag a leaked piece of a credential three or more
  characters long, letters included; they used to skip all-letter pieces.
  They cover every credential shape, plus credentials with word-like edges,
  at every wrap offset at 40, 80, 100, 120 and 200 columns, read as LF, CRLF
  or with ANSI escapes, and the pi-herdr-agents#150 screen.

## 0.1.2 (2026-11-16)

Fixes for giuseppecrj/pi-herdr-agents#149, where every child failed with a bare
"exit code 1" because `config.json` held only `models`.

- An omitted `status` section, or an omitted `status.enabled`, now keeps the
  shipped default (enabled), as every other section already did. A present but
  malformed section still stops the load with an error naming the file and key.
- The task-model writer publishes `config.json` with mode `0600`. It already
  kept every other key; it now also keeps the file owner-only.
- A child that exits before its session starts reports its last terminal lines
  (at most 12 lines and 2,000 characters, with credential-shaped values masked)
  after the exit code, so the parent sees why it failed. Masking covers AWS
  access key IDs (`AKIA`, `ASIA` and the other documented prefixes), 40-character
  AWS secret keys (including `/` and `+`), JWTs of any length, `Authorization`
  headers in any case, and the earlier API-key, token, URL and opaque shapes.
  Rows a terminal wrapped are rejoined and masked again, so a credential split
  across rows is masked on each one. The terminal read waits at most 3 seconds.
- Copies may now carry a recorded `owned_change` (the reason and the exact blob):
  after H2 Maestro owns the source, and `check:copy-fidelity` still verifies
  the pinned original and fails on any unrecorded edit.

## 0.1.1

Corrective packaging release. No code changes.

- `engines.node` is widened from `>=26.12.1` to `>=22.19.0`, pi's own floor.
  With npm `engine-strict`, 0.1.0's `>=26.12.1` stopped Node 22 users from
  installing pi-herdr-agents. The published JavaScript passes the
  packed-tarball package tests on Node 22.19.0, and CI now runs those tests on
  Node 22 too (`node22-runtime`).
- Development and the source suite still need Node `>=26.12.1`.

## 0.1.0

First extracted release. See
[`docs/release-readiness.md`](docs/release-readiness.md).
