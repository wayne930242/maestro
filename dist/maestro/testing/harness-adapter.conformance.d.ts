import { describe as nodeDescribe, it as nodeIt } from "node:test";
import type { HarnessAdapter, SpawnOptions } from "../../maestro/core/harness-adapter.ts";
import type { AgentHandle } from "../../maestro/core/types.ts";
interface TestRunner {
    describe: typeof nodeDescribe;
    it: typeof nodeIt;
}
export interface HarnessAdapterFixture {
    adapter: HarnessAdapter;
    /** Fake fixtures retain the tight default; real process fixtures choose a bounded budget. */
    waitTimeoutMs?: number;
    /** Raw provider errors need not contain the literal word "error". */
    errorMessagePattern?: RegExp;
    /** Explicit saved-session policy expectation, not an arbitrary rejection allowance. */
    managedSessionResume?: {
        kind: "refused";
        message: RegExp;
    } | {
        kind: "detached";
    };
    spawnOptions(): SpawnOptions;
    finish(handle: AgentHandle, kind: "done" | "ping" | "error"): Promise<void>;
    /** Optional implementation-specific simulation of delayed sidecar evidence after pane absence. */
    lateSidecar?(handle: AgentHandle): Promise<void>;
    /** Optional hook for implementations that need provider-specific worktree setup before spawn. */
    worktreeSpawnOptions?(base: SpawnOptions): Promise<SpawnOptions>;
    dispose(): Promise<void>;
}
export declare function registerHarnessAdapterConformance(runner: TestRunner, name: string, factory: () => Promise<HarnessAdapterFixture>): void;
export {};
//# sourceMappingURL=harness-adapter.conformance.d.ts.map