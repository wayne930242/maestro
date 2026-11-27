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
