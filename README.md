# @nubl/maestro

Harness-neutral subagent engine: delegation, checked outcomes and a pluggable execution seam. It will serve both pi-worker and pi-herdr-agents.

**Status:** `0.1.0` release candidate (M6): the generic run owner, the Pi adapters/runtime with explicit host ports, and the Pi tool surface behind `createPiExtension`, extracted from pi-herdr-agents without behavior changes. Not yet published; see [release readiness](docs/release-readiness.md).

## Development

Develop on Node **>=26.12.1** with `npm ci`. Installed consumers need only
Node **>=22.19.0**, pi's own floor. `npm run build` emits JavaScript,
declarations and source maps into `dist/`; `npm run test:package` installs a
fresh tarball and tests the emitted package without Pi peers or TypeScript loaders.

The package root (`@nubl/maestro`) and `@nubl/maestro/engine` are the same
engine entry. `@nubl/maestro/engine` exposes `createRunSession`, `defaultRetainSurface` and
existing core/run-session types without Pi peers, config discovery or provider
initialization. `@nubl/maestro/testing` exposes the two fakes and reusable
conformance runners. These entries execute emitted JavaScript.

`@nubl/maestro/runtime` is the Pi-aware runtime barrel (`createDefaultRunSession`
and its option types). A terminal host composes it with an explicit
`HostSurfaceBinding` (`@nubl/maestro/runtime/host-surface-binding`): binding
resolution, the owning provider, a per-launch provider and the optional marker
transport. Without that binding or the closed injected-infrastructure test
composition, session creation fails. `@nubl/maestro/pi/child` exports the
protocol-only child extension (default; the same instance the emitted launch
entry `DEFAULT_CHILD_ENTRY_PATH` loads) and `createChildExtension(renderWidget)`
for a host's child wrapper; a host may pass that wrapper as `childEntryPath`. Entries that
import Pi or TypeBox require the optional peers; the root, `./engine` and
`./testing` stay Pi-free.

`@nubl/maestro/pi` exports `createPiExtension(hostOptions)`, the per-load Pi
factory for the public tools (`subagent`, `subagent_cancel`, `subagent_send`,
`caller_ping` and the rest; see [the tool reference](docs/tools.md) and
[the delegation-outcome contract](docs/delegation-outcome-contract.md)). A host
calls it once per Pi load with its `HostSurfaceBinding`, `PiPresentationHooks`
(widgets, message and tool renderers) and optional child entry/config asset
paths; the package registers nothing by itself and ships no Pi auto-discovery.
`@nubl/maestro/pi/extension` is the same factory as a callable default export,
for a host wrapper; it is not a zero-config extension path.

The finite `./core/*`, `./runtime/*`, `./adapters/pi/*` and `./pi/subagents/*`
compatibility families (including nested config/roles modules, the child
protocol modules and `./pi/subagents/index`, whose default delegates to the
factory) are
**internal-compat, no stability promise**. The stars describe a family, not
wildcard exports.
For tracked runs, the versioned contract is the `pi-herdr-agents:runs:v1` wire protocol; `readTrackedRuns` and its `./core/tracked-runs` module are internal-compat.
No Herdr provider, terminal widget or renderer, terminal
entry or experimental worker entry ships here.

Run `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm test`,
`npm run test:fidelity`, `npm run check:copy-fidelity`, `npm run build`,
`npm run check:boundaries`, `npm run test:coverage`, `npm run docs:tools:check`,
`npm run test:package` and `npm pack --dry-run` before submission. Unit/coverage runs use an isolated HOME,
agent directory and credential-free environment; reports remain under ignored
`evidence/`. Coverage gates every measured copied original file against its
unchanged M1 floor (lines changed upstream after the baseline are mapped and held
to the baseline hit rate on the same lines), not a global package threshold.
See [the extraction plan](docs/plan/extraction.md) and
[provenance records](provenance/README.md) for pins, coverage and later gates.

## Pane configuration

`panes.minSplitCols` sets the minimum number of usable columns the caller keeps after a right split. It defaults to 80 and accepts positive safe integers. If the legacy Herdr host cannot confirm that width, it uses grouped placement instead. Down splits leave the width unchanged, so they do not use this setting.

## Publishing

Releases publish to npm from GitHub Actions with npm trusted publishing (OIDC). No npm token is stored in this repository.

1. Bump `version` in `package.json` and merge to `main`.
2. Push a tag `vX.Y.Z` that matches the version.
3. `.github/workflows/publish.yml` checks the tag against `package.json`, installs the lockfile, validates, builds and tests an installed tarball before publishing. Prerelease versions publish under `next`; stable versions keep `latest`. The `npm-publish` environment can require an approval.

The repository is public, so npm attaches a provenance statement to every release.
