/** Largest SKILL.md injected. */
export declare const SKILL_FILE_MAX_BYTES: number;
/** Largest combined size of all skill files read, and of all injected blocks. */
export declare const SKILLS_TOTAL_MAX_BYTES: number;
/** The fields of Pi's loaded `Skill` this module reads. */
interface LoadedSkill {
    name: string;
    filePath: string;
    baseDir: string;
}
interface BeforeAgentStart {
    systemPromptOptions: {
        skills?: readonly LoadedSkill[];
    };
}
/** The node:fs calls used for bounded reads; injectable for tests. */
export interface SkillFileSystem {
    statSync(path: string): {
        isFile(): boolean;
        size: number;
    };
    openSync(path: string, flags: "r"): number;
    readSync(fd: number, buffer: Buffer, offset: number, length: number, position: number): number;
    closeSync(fd: number): void;
}
/**
 * A `before_agent_start` handler that injects the declared skills once, on
 * its first call, and nothing afterwards.
 */
export declare function createDeclaredSkillsInjector(names: readonly string[], fs?: SkillFileSystem): (event: BeforeAgentStart) => {
    message: {
        customType: string;
        content: string;
        display: boolean;
        details: {
            injected: number;
            notLoaded: string[];
            skipped: string[];
        };
    };
} | undefined;
/**
 * Inject the skills named in {@link DECLARED_SKILLS_ENV} on this process's
 * first run. The first run consumes the variable, so a reloaded extension or
 * a process this child starts never injects them again.
 */
export declare function registerDeclaredSkills(pi: {
    on(event: "before_agent_start", handler: (event: BeforeAgentStart) => ReturnType<ReturnType<typeof createDeclaredSkillsInjector>>): void;
}, env?: NodeJS.ProcessEnv): void;
export {};
//# sourceMappingURL=declared-skills.d.ts.map