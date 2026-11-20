export type HerdrBackend = "auto" | "legacy" | "core";
export declare function parseHerdrConfig(raw: any, source?: string): HerdrBackend;
export declare function loadHerdrConfig(configDir: string, examplePath: string): HerdrBackend;
export type HerdrBinding = {
    backend: "legacy";
} | {
    backend: "core";
    socket: string;
    parentTerminal: string;
};
export declare function selectHerdrBinding(backend: HerdrBackend, env: NodeJS.ProcessEnv, platform?: NodeJS.Platform): HerdrBinding;
export declare function assertSameHerdrBinding(previous: HerdrBinding, next: HerdrBinding): void;
//# sourceMappingURL=herdr-config.d.ts.map