import type { OpenedPrimaryWorkspaceReport } from "../../core/opened-primary-workspace.ts";
import type { CreateSurfaceOptions, CreateWorktreeSurfaceOptions, ReportOpenedPrimaryWorkspaceInput, SurfaceInfo, SurfaceProcessInfo, SurfaceProvider, WorktreeSurface, WorktreeSurfaceInfo } from "../../core/surface-provider.ts";
import type { PaneInspection, SurfaceHandle } from "../../core/types.ts";
interface FakeSurfaceProviderOptions {
    maxPerTab?: number;
}
export declare class FakeSurfaceProvider implements SurfaceProvider {
    #private;
    readonly name = "fake";
    constructor(options?: FakeSurfaceProviderOptions);
    isAvailable(): boolean;
    createSurface(opts: CreateSurfaceOptions): string;
    runCommand(surfaceId: string, command: string): void;
    readScreen(surfaceId: string, lines?: number): string;
    closeSurface(surfaceId: string): void;
    listSurfaces(_opts?: {
        timeoutMs?: number;
    }): SurfaceInfo[];
    attachSurface(id: string): SurfaceHandle;
    createWorktreeSurface(opts: CreateWorktreeSurfaceOptions): WorktreeSurface;
    removeWorktreeSurface(workspaceId: string, _opts?: {
        timeoutMs?: number;
    }): void;
    reportOpenedPrimaryWorkspace(_input: ReportOpenedPrimaryWorkspaceInput): OpenedPrimaryWorkspaceReport | undefined;
    setupHint(): string;
    runScript(surfaceId: string, command: string, options: {
        scriptPath: string;
        scriptPreamble: string;
    }): string;
    inspectSurface(surfaceId: string): Promise<PaneInspection>;
    sendKeys(surfaceId: string, keys: string): void;
    getProcessInfo(surfaceId: string, _opts?: {
        timeoutMs?: number;
    }): SurfaceProcessInfo;
    waitForShellReady(surfaceId: string): Promise<void>;
    waitForSurfaceAbsence(surfaceId: string, opts?: {
        timeoutMs?: number;
    }): Promise<void>;
    listWorktreeSurfaces(opts?: {
        cwd?: string;
        timeoutMs?: number;
    }): Promise<WorktreeSurfaceInfo[]>;
    focusWorkspace(workspaceId: string): void;
    setTitle(target: "tab" | "workspace", title: string): void;
    scriptInspection(surfaceId: string, inspection: PaneInspection): void;
    appendScreen(surfaceId: string, text: string): void;
    commands(surfaceId: string): string[];
    recordWorktreeInfo(info: WorktreeSurfaceInfo, opts?: {
        cwd?: string;
    }): void;
    removeSurface(surfaceId: string): void;
}
export {};
//# sourceMappingURL=fake-surface-provider.d.ts.map