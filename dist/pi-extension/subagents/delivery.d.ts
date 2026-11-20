import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { Task } from "../../maestro/core/types.ts";
import type { PiRunRecord, PiCompletedMetadata, PiPersistentIO, PiSettlementIO, PiPersistentEvent, PiLedgerEntry } from "../../maestro/runtime/index.ts";
import type { WorktreeHandoff } from "../../maestro/core/worktree.ts";
import { type RunningSubagent, type SubagentRuntime } from "./state.ts";
import { type PersistentControls } from "./persistent.ts";
interface DeliveryDeps {
    runtime: SubagentRuntime;
    updateWidget: () => void;
    startPersistentStopTimeout: PersistentControls["startPersistentStopTimeout"];
    /** Parent clock for notice spacing; tests inject one. */
    now?: () => number;
}
/** Parent delivery of child results, bound to one extension instance. */
export declare function createDelivery({ runtime, updateWidget, startPersistentStopTimeout, now, }: DeliveryDeps): {
    deliverPersistentTaskEvent: (running: RunningSubagent, event: PiPersistentEvent, api: Pick<ExtensionAPI, "sendMessage">, io: PiPersistentIO, ledgerSnapshot?: PiLedgerEntry[]) => void;
    drainPersistentTaskEvents: (running: RunningSubagent, api: Pick<ExtensionAPI, "sendMessage">, io: PiPersistentIO) => void;
    notifyPersistentCrash: (running: RunningSubagent, api: Pick<ExtensionAPI, "sendMessage">, io: PiPersistentIO, worktree?: WorktreeHandoff) => void;
    deliverPiCompletion: (record: PiRunRecord, result: PiCompletedMetadata, task: Task, io: PiSettlementIO) => "delivered" | "suppressed" | Promise<"delivered" | "suppressed">;
};
export {};
//# sourceMappingURL=delivery.d.ts.map