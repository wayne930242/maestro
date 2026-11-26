import { randomUUID } from "node:crypto";
import { resolveProjectTrusted, } from "../../maestro/runtime/index.js";
import { resolveRuntimePlans, } from "../../maestro/core/routing.js";
import { sessionModelRegistry } from "./model-registry.js";
import { resolveModelDefault, } from "../../maestro/core/config/model-config.js";
import { getAgentConfigDir } from "./config-path.js";
import { normalizeAcceptSpec } from "../../maestro/core/accept.js";
import { SubagentParams, resolveDenyTools, discoverAgentCatalog, missingRoleMessage, resolveEffectiveSessionMode, resolveEffectivePersistent, resolveEffectiveAutoExit, resolveEffectiveInteractive, loadAgentDefaults, } from "./catalog.js";
/** Launch snapshots and runtime plans bound to one extension instance. */
export function createLaunchPlanner({ runtime, modelConfig, paneConfig, }) {
    function normalizePiAttempt(params, ctx, parentThinking, options) {
        const agentDefs = params.agent
            ? loadAgentDefaults(params.agent, runtime.pi)
            : null;
        if (params.agent && !agentDefs) {
            const diagnostic = discoverAgentCatalog(runtime.pi).diagnostics.find((candidate) => candidate.agentName === params.agent);
            // Raw here: the public tool boundary and the delivery serializer encode.
            throw new Error(diagnostic ? diagnostic.message : missingRoleMessage(params.agent));
        }
        if (!ctx.model)
            throw new Error("Subagent launch requires a resolved parent model");
        const effectiveTools = params.tools ?? agentDefs?.tools;
        const effectiveSkills = params.skills ?? agentDefs?.skills;
        const persistent = resolveEffectivePersistent(params, agentDefs);
        const effectiveAutoExit = resolveEffectiveAutoExit(params, agentDefs);
        const effectiveInteractive = resolveEffectiveInteractive(params, agentDefs);
        const logicalId = options.id;
        const generationId = randomUUID();
        const taskId = randomUUID();
        const parentSessionFile = ctx.sessionManager.getSessionFile();
        if (!parentSessionFile)
            throw new Error("No session file");
        const snapshot = launchSnapshot(ctx, parentThinking);
        return {
            snapshot: {
                ...snapshot,
                parent: { ...snapshot.parent, ...options.origin },
            },
            task: {
                id: options.controlTaskId,
                name: params.name,
                ...(params.item !== undefined && { item: params.item }),
                prompt: params.task,
                role: params.agent ?? "",
                cwd: options.origin.cwd,
                worktree: params.worktree ?? undefined,
                accept: params.accept ? normalizeAcceptSpec(params.accept) : undefined,
                requestedModel: params.model,
                session: {
                    mode: resolveEffectiveSessionMode(params, agentDefs),
                    parentSessionId: snapshot.parent.sessionId,
                },
                behavior: {
                    skills: effectiveSkills
                        ?.split(",")
                        .map((s) => s.trim())
                        .filter(Boolean),
                    denyTools: [...resolveDenyTools(agentDefs)],
                    autoExit: effectiveAutoExit,
                    interactive: effectiveInteractive,
                    persistent,
                    notify: params.notify === true,
                    systemPromptMode: agentDefs?.systemPromptMode,
                    solutionSpace: params.solutionSpace?.trim() || undefined,
                },
                systemPrompt: params.agent ? undefined : params.systemPrompt,
            },
            role: agentDefs
                ? {
                    ...agentDefs.role,
                    systemPrompt: agentDefs.body ?? params.systemPrompt ?? "",
                }
                : {
                    name: "",
                    version: "1",
                    description: "Pi host-resolved role",
                    systemPrompt: params.systemPrompt ?? "",
                    allowedTools: [],
                },
            resolved: {
                agent: params.agent,
                cwd: params.cwd,
                roleCwd: agentDefs?.cwd,
                tools: effectiveTools,
            },
            identity: { id: logicalId, logicalId, generationId, taskId },
        };
    }
    function resolveSubagentRuntimePlans(params, ctx, parentThinking) {
        const agentDefs = params.agent
            ? loadAgentDefaults(params.agent, runtime.pi)
            : null;
        if (params.agent && !agentDefs) {
            const diagnostic = discoverAgentCatalog(runtime.pi).diagnostics.find((candidate) => candidate.agentName === params.agent);
            // Raw here: the public tool boundary and the delivery serializer encode.
            throw new Error(diagnostic ? diagnostic.message : missingRoleMessage(params.agent));
        }
        if (!ctx.model)
            throw new Error("Subagent launch requires a resolved parent model");
        const plans = resolveRuntimePlans({ model: params.model, thinking: params.thinking }, {
            model: resolveModelDefault(params.agent, agentDefs?.model, modelConfig),
            thinking: agentDefs?.thinking,
        }, {
            provider: ctx.model.provider,
            modelId: ctx.model.id,
            thinking: parentThinking,
        }, sessionModelRegistry(ctx), modelConfig.tasks, !!params.worktree, modelConfig.tasksThinking);
        if (params.worktree && plans.length > 1) {
            throw new Error("Model fallbacks are not supported for worktree subagents.");
        }
        return plans;
    }
    function launchSnapshot(ctx, thinking) {
        return {
            parent: {
                cwd: ctx.cwd,
                invocationCwd: process.cwd(),
                sessionFile: ctx.sessionManager.getSessionFile() ?? "",
                sessionId: ctx.sessionManager.getSessionId(),
                sessionDir: ctx.sessionManager.getSessionDir(),
                agentDir: getAgentConfigDir(),
            },
            parentRuntime: ctx.model && thinking
                ? { provider: ctx.model.provider, modelId: ctx.model.id, thinking }
                : undefined,
            modelRegistry: sessionModelRegistry(ctx),
            paneConfig,
            // Pi 0.79.0 gates project settings but cannot report the decision, so
            // an unreported decision is untrusted wherever Pi has the gate.
            scriptShell: {
                cwd: ctx.cwd,
                projectTrusted: resolveProjectTrusted(ctx.isProjectTrusted?.()),
            },
        };
    }
    return { normalizePiAttempt, resolveSubagentRuntimePlans, launchSnapshot };
}
//# sourceMappingURL=launch.js.map