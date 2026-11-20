import path from "node:path";
export class FakeSurfaceProvider {
    name = "fake";
    #nextSurface = 1;
    #nextWorkspace = 1;
    #nextWorkspaceGroup = 1;
    #maxPerTab;
    #surfaces = new Map();
    #worktrees = new Map();
    #worktreeInfo = [];
    #titles = new Map();
    constructor(options = {}) {
        this.#maxPerTab = options.maxPerTab ?? 4;
    }
    isAvailable() {
        return true;
    }
    createSurface(opts) {
        const id = `fake-surface-${this.#nextSurface}`;
        this.#nextSurface += 1;
        const group = this.#groupFor(opts.placement?.kind ?? "grouped");
        this.#surfaces.set(id, {
            id,
            name: opts.name,
            cwd: opts.cwd,
            group,
            screen: [],
            commands: [],
            keys: [],
            processInfo: { pids: [], foregroundProcesses: [] },
        });
        return id;
    }
    runCommand(surfaceId, command) {
        const surface = this.#surface(surfaceId);
        surface.commands.push(command);
        surface.screen.push(`$ ${command}`);
        const echoText = echoOutput(command);
        if (echoText !== null) {
            surface.screen.push(echoText);
        }
    }
    readScreen(surfaceId, lines) {
        const surface = this.#surface(surfaceId);
        const screen = lines === undefined ? surface.screen : surface.screen.slice(-lines);
        return screen.join("\n");
    }
    closeSurface(surfaceId) {
        this.removeSurface(surfaceId);
    }
    listSurfaces(_opts) {
        return Array.from(this.#surfaces.values(), ({ id, name, cwd, group, workspaceId }) => {
            const info = { id, name, cwd, group };
            if (workspaceId)
                info.workspaceId = workspaceId;
            return info;
        });
    }
    attachSurface(id) {
        this.#surface(id);
        return {
            id,
            runCommand: (command) => this.runCommand(id, command),
            readScreen: (lines) => this.readScreen(id, lines),
            sendKeys: (keys) => this.sendKeys(id, keys),
            close: () => this.closeSurface(id),
        };
    }
    createWorktreeSurface(opts) {
        const workspaceId = `fake-workspace-${this.#nextWorkspace}`;
        this.#nextWorkspace += 1;
        const worktreePath = path.join(opts.cwd, sanitizePathPart(opts.branch));
        const surfaceId = this.createSurface({
            name: opts.name,
            cwd: worktreePath,
            placement: { kind: "tab" },
        });
        const surface = this.#surface(surfaceId);
        surface.workspaceId = workspaceId;
        const worktree = {
            path: worktreePath,
            branch: opts.branch,
            workspaceId,
            surfaceId,
        };
        this.#worktrees.set(workspaceId, worktree);
        this.#worktreeInfo.push({
            path: worktree.path,
            branch: worktree.branch,
            workspaceId,
            isLinkedWorktree: true,
            sourceCwd: opts.cwd,
        });
        return worktree;
    }
    removeWorktreeSurface(workspaceId, _opts) {
        const worktree = this.#worktrees.get(workspaceId);
        if (!worktree)
            return;
        this.#worktrees.delete(workspaceId);
        this.#worktreeInfo = this.#worktreeInfo.filter((info) => info.workspaceId !== workspaceId);
        this.removeSurface(worktree.surfaceId);
    }
    reportOpenedPrimaryWorkspace(_input) {
        return undefined;
    }
    setupHint() {
        return "Fake surface provider is always available in memory.";
    }
    runScript(surfaceId, command, options) {
        const surface = this.#surface(surfaceId);
        surface.commands.push(command);
        surface.screen.push(`$ ${options.scriptPath}`);
        if (options.scriptPreamble.length > 0) {
            surface.screen.push(options.scriptPreamble);
        }
        const echoText = echoOutput(command);
        if (echoText !== null) {
            surface.screen.push(echoText);
        }
        return options.scriptPath;
    }
    async inspectSurface(surfaceId) {
        const surface = this.#surfaces.get(surfaceId);
        if (!surface) {
            return { kind: "missing", error: `surface not found: ${surfaceId}` };
        }
        return (surface.inspection ?? {
            kind: "present",
            agentStatus: "idle",
            observedAt: Date.now(),
        });
    }
    sendKeys(surfaceId, keys) {
        this.#surface(surfaceId).keys.push(keys);
    }
    getProcessInfo(surfaceId, _opts) {
        const processInfo = this.#surface(surfaceId).processInfo;
        return {
            shellPid: processInfo.shellPid,
            foregroundProcessGroupId: processInfo.foregroundProcessGroupId,
            pids: [...processInfo.pids],
            foregroundProcesses: processInfo.foregroundProcesses.map((process) => ({
                ...process,
                argv: process.argv ? [...process.argv] : undefined,
            })),
        };
    }
    async waitForShellReady(surfaceId) {
        this.#surface(surfaceId);
    }
    async waitForSurfaceAbsence(surfaceId, opts = {}) {
        if (!this.#surfaces.has(surfaceId))
            return;
        throw new Error(`surface still present after ${opts.timeoutMs ?? 0}ms: ${surfaceId}`);
    }
    async listWorktreeSurfaces(opts) {
        void opts?.timeoutMs;
        return this.#worktreeInfo
            .filter((worktree) => opts?.cwd === undefined || worktree.sourceCwd === opts.cwd)
            .map(({ sourceCwd, ...worktree }) => {
            void sourceCwd;
            return { ...worktree };
        });
    }
    focusWorkspace(workspaceId) {
        void workspaceId;
    }
    setTitle(target, title) {
        this.#titles.set(target, title);
    }
    scriptInspection(surfaceId, inspection) {
        this.#surface(surfaceId).inspection = inspection;
    }
    appendScreen(surfaceId, text) {
        this.#surface(surfaceId).screen.push(...text.split("\n"));
    }
    commands(surfaceId) {
        return [...this.#surface(surfaceId).commands];
    }
    recordWorktreeInfo(info, opts) {
        this.#worktreeInfo.push({ ...info, sourceCwd: opts?.cwd });
    }
    removeSurface(surfaceId) {
        this.#surfaces.delete(surfaceId);
        for (const [workspaceId, worktree] of this.#worktrees) {
            if (worktree.surfaceId === surfaceId) {
                this.#worktrees.delete(workspaceId);
                this.#worktreeInfo = this.#worktreeInfo.filter((info) => info.workspaceId !== workspaceId);
            }
        }
    }
    #surface(surfaceId) {
        const surface = this.#surfaces.get(surfaceId);
        if (!surface) {
            throw new Error(`surface not found: ${surfaceId}`);
        }
        return surface;
    }
    #groupFor(kind) {
        if (kind === "tab") {
            const group = `fake-tab-group-${this.#nextWorkspaceGroup}`;
            this.#nextWorkspaceGroup += 1;
            return group;
        }
        if (kind === "split") {
            return "fake-split-group";
        }
        const groupCounts = new Map();
        for (const surface of this.#surfaces.values()) {
            const match = /^fake-agents-(\d+)$/.exec(surface.group ?? "");
            if (!match)
                continue;
            const groupIndex = Number(match[1]);
            groupCounts.set(groupIndex, (groupCounts.get(groupIndex) ?? 0) + 1);
        }
        for (let groupIndex = 1;; groupIndex += 1) {
            if ((groupCounts.get(groupIndex) ?? 0) < this.#maxPerTab) {
                return `fake-agents-${groupIndex}`;
            }
        }
    }
}
function echoOutput(command) {
    const match = /^echo(?:\s+(.+))?$/.exec(command.trim());
    return match ? (match[1] ?? "") : null;
}
function sanitizePathPart(value) {
    return value.replaceAll(/[^A-Za-z0-9._-]/g, "-");
}
//# sourceMappingURL=fake-surface-provider.js.map