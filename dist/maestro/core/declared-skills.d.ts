/**
 * A role's declared skills travel from parent to child by name only. The
 * parent validates the names and exports them as a JSON array in
 * `PI_SUBAGENT_SKILLS`; the child's own Pi decides which of them exist.
 */
export declare const DECLARED_SKILLS_ENV = "PI_SUBAGENT_SKILLS";
export declare function isSkillName(name: string): boolean;
/**
 * Split a comma-separated `skills` declaration, keeping first occurrences.
 * Throws on a name Pi's skill-name rules reject.
 */
export declare function parseDeclaredSkills(value: string | undefined): string[];
export declare function formatDeclaredSkillsEnv(names: readonly string[]): string;
/** Absent, empty or malformed values mean no skills; invalid names drop. */
export declare function parseDeclaredSkillsEnv(raw: string | undefined): string[];
//# sourceMappingURL=declared-skills.d.ts.map