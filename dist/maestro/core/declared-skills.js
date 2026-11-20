/**
 * A role's declared skills travel from parent to child by name only. The
 * parent validates the names and exports them as a JSON array in
 * `PI_SUBAGENT_SKILLS`; the child's own Pi decides which of them exist.
 */
import { isString } from "./config/type-guards.js";
export const DECLARED_SKILLS_ENV = "PI_SUBAGENT_SKILLS";
/** Pi's skill-name rules: 1-64 of a-z, 0-9 and single inner hyphens. */
const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SKILL_NAME_MAX_LENGTH = 64;
export function isSkillName(name) {
    return name.length <= SKILL_NAME_MAX_LENGTH && SKILL_NAME.test(name);
}
/**
 * Split a comma-separated `skills` declaration, keeping first occurrences.
 * Throws on a name Pi's skill-name rules reject.
 */
export function parseDeclaredSkills(value) {
    const names = [
        ...new Set((value ?? "")
            .split(",")
            .map((name) => name.trim())
            .filter(Boolean)),
    ];
    const invalid = names.find((name) => !isSkillName(name));
    if (invalid !== undefined)
        throw new Error(`Invalid skill name ${JSON.stringify(invalid)} in the declared skills: ` +
            `a skill name is 1-${SKILL_NAME_MAX_LENGTH} lowercase letters, digits ` +
            `and single hyphens, not starting or ending with a hyphen (Pi's ` +
            `skill-name rules). Use the \`name\` from the skill's SKILL.md ` +
            `frontmatter, or rename a skill that breaks these rules.`);
    return names;
}
export function formatDeclaredSkillsEnv(names) {
    return JSON.stringify(names);
}
/** Absent, empty or malformed values mean no skills; invalid names drop. */
export function parseDeclaredSkillsEnv(raw) {
    if (!raw)
        return [];
    let parsed;
    try {
        parsed = JSON.parse(raw);
    }
    catch {
        return [];
    }
    if (!Array.isArray(parsed))
        return [];
    return [...new Set(parsed.filter(isString).filter(isSkillName))];
}
//# sourceMappingURL=declared-skills.js.map