import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
/** The subagents_write_task_models tool (parent sessions only). */
export declare function registerTaskModelTool(pi: ExtensionAPI, { shouldRegister, configExamplePath, }: {
    shouldRegister: (name: string) => boolean;
    configExamplePath?: string;
}): void;
/** The /subagents-init command and its cross-extension start event. */
export declare function registerTaskModelInit(pi: ExtensionAPI): void;
//# sourceMappingURL=task-models.d.ts.map