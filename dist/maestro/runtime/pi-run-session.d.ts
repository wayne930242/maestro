import type { SubagentLifecycle, ActivityReadResult } from "../core/types.ts";
import { type RunObservation } from "./run-session.ts";
import type { DefaultRunSessionOptions, PiRunSession } from "./pi-run-session-types.ts";
export declare function observePiActivity(input: {
    id: string;
    activityFile?: string;
    lifecycle: SubagentLifecycle;
}, observedAt: number): RunObservation & {
    activityRead: ActivityReadResult;
};
export declare function createDefaultRunSession(options: DefaultRunSessionOptions, previous?: PiRunSession): PiRunSession;
//# sourceMappingURL=pi-run-session.d.ts.map