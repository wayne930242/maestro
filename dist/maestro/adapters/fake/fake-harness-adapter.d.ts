import type { HarnessAdapter, ResumeOptions, SpawnOptions } from "../../core/harness-adapter.ts";
import type { AgentHandle, AgentState, CompletionEvidence } from "../../core/types.ts";
export declare class FakeHarnessAdapter implements HarnessAdapter {
    #private;
    readonly name = "fake";
    isAvailable(): boolean;
    spawn(opts: SpawnOptions): Promise<AgentHandle>;
    resume(opts: ResumeOptions): Promise<AgentHandle>;
    getState(handle: AgentHandle): Promise<AgentState>;
    interrupt(handle: AgentHandle): Promise<void>;
    kill(handle: AgentHandle): Promise<void>;
    sendInput(handle: AgentHandle, text: string): Promise<void>;
    readOutput(handle: AgentHandle, lines?: number): Promise<string>;
    exitCode(handle: AgentHandle): number | undefined;
    awaitCompletion(handle: AgentHandle, signal: AbortSignal): Promise<CompletionEvidence>;
    complete(handleId: string, evidence: CompletionEvidence): void;
    fail(handleId: string, error: string): void;
    ping(handleId: string, message: string): void;
    spawned(): AgentHandle[];
    inputs(handleId: string): string[];
    request(handleId: string): SpawnOptions | ResumeOptions | undefined;
    appendOutput(handleId: string, text: string): void;
}
//# sourceMappingURL=fake-harness-adapter.d.ts.map