import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { PiToolRenderers } from "./presentation-hooks.ts";
import type { SupervisionConfig } from "../../maestro/core/config/supervision-config.ts";
import type { SubagentRuntime } from "./state.ts";
import { type Controls } from "./controls.ts";
import type { PersistentControls } from "./persistent.ts";
interface ControlToolDeps {
    /** Terminal callbacks are supplied by the host, not the tool implementation. */
    renderers?: PiToolRenderers;
    shouldRegister: (name: string) => boolean;
    runtime: SubagentRuntime;
    supervisionConfig: SupervisionConfig;
    resolvePersistentTarget: PersistentControls["resolvePersistentTarget"];
    handleSubagentInterrupt: Controls["handleSubagentInterrupt"];
    handleSubagentCancel: Controls["handleSubagentCancel"];
    formatLivePersistentSpecialists: PersistentControls["formatLivePersistentSpecialists"];
}
/** Persistent send/stop, interrupt, cancel, and the role listing tools. */
export declare function registerControlTools(pi: ExtensionAPI, { shouldRegister, runtime, supervisionConfig, resolvePersistentTarget, renderers, handleSubagentInterrupt, handleSubagentCancel, formatLivePersistentSpecialists, }: ControlToolDeps): void;
export {};
//# sourceMappingURL=control-tools.d.ts.map