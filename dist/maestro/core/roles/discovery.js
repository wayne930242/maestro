import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { isString } from "../config/type-guards.js";
import { isThinkingLevel } from "../routing.js";
export const ROLE_PACK_DISCOVERY_EVENT = "pi-herdr-subagents:roles:discover:v1";
function runtimeRole(definition, source, providerVersion) {
    return {
        name: definition.name,
        version: providerVersion ?? "1",
        description: definition.description ?? "",
        systemPrompt: definition.body ?? "",
        allowedTools: definition.tools
            ?.split(",")
            .map((tool) => tool.trim())
            .filter(Boolean) ?? [],
        defaults: {
            model: definition.model,
            thinking: definition.thinking,
            sessionMode: definition.sessionMode,
            spawning: definition.spawning,
            selfSpawn: definition.selfSpawn,
            autoExit: definition.autoExit,
            interactive: definition.interactive,
            persistent: definition.persistent,
            systemPromptMode: definition.systemPromptMode,
            denyTools: definition.denyTools
                ?.split(",")
                .map((tool) => tool.trim())
                .filter(Boolean),
            skills: definition.skills
                ?.split(",")
                .map((skill) => skill.trim())
                .filter(Boolean),
            cwd: definition.cwd,
        },
        source,
    };
}
function getFrontmatterLines(frontmatter, key) {
    const prefix = `${key}:`;
    return frontmatter
        .split("\n")
        .filter((candidate) => candidate.startsWith(prefix));
}
function getFrontmatterValue(frontmatter, key) {
    const line = getFrontmatterLines(frontmatter, key)[0];
    return line?.slice(`${key}:`.length).trim() || undefined;
}
function isCapabilityDeclaration(line, field) {
    const trimmed = line.trimStart();
    const colon = trimmed.indexOf(":");
    if (colon === -1)
        return false;
    const key = trimmed.slice(0, colon).trim();
    return key === field || key === `"${field}"` || key === `'${field}'`;
}
function getCapabilityDeclarations(frontmatter, field) {
    const canonicalPrefix = `${field}:`;
    const lines = frontmatter.split("\n");
    return {
        canonical: lines.filter((line) => line.startsWith(canonicalPrefix)),
        hasNoncanonical: lines.some((line) => isCapabilityDeclaration(line, field) &&
            !line.startsWith(canonicalPrefix)),
    };
}
function validateCapabilityDeclarations(frontmatter) {
    for (const field of [
        "tools",
        "deny-tools",
        "spawning",
        "self-spawn",
        "persistent",
    ]) {
        const declarations = getCapabilityDeclarations(frontmatter, field);
        if (declarations.hasNoncanonical) {
            return `${field} must use an unquoted, unindented key written exactly as ${field}:`;
        }
        if (declarations.canonical.length > 1) {
            return `${field} may be declared only once.`;
        }
        if (declarations.canonical.length === 0)
            continue;
        const value = declarations.canonical[0].slice(`${field}:`.length).trim();
        if (field === "spawning" ||
            field === "self-spawn" ||
            field === "persistent") {
            if (value !== "true" && value !== "false") {
                return `${field} must be true or false.`;
            }
            continue;
        }
        if (!value ||
            value.startsWith("[") ||
            value.startsWith("{") ||
            value.startsWith("|") ||
            value.startsWith(">") ||
            value.includes("#") ||
            value.includes('"') ||
            value.includes("'") ||
            value.split(",").some((entry) => !entry.trim())) {
            return `${field} must use a non-empty comma-separated scalar; YAML lists and containers, comments and quotes are unsupported.`;
        }
    }
    return undefined;
}
function parseOptionalBoolean(value) {
    return value == null ? undefined : value === "true";
}
function parseSessionMode(value) {
    if (value === "standalone" || value === "lineage-only" || value === "fork") {
        return value;
    }
    return undefined;
}
function normalizeRoleText(content) {
    return content.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
}
function parseAgentDefinition(content, fallbackName) {
    const match = content.match(/^---\n([\s\S]*?)\n---/);
    if (!match)
        return null;
    const frontmatter = match[1];
    const body = content.replace(/^---\n[\s\S]*?\n---\n*/, "").trim();
    const systemPromptMode = getFrontmatterValue(frontmatter, "system-prompt");
    const thinking = getFrontmatterValue(frontmatter, "thinking");
    return {
        name: getFrontmatterValue(frontmatter, "name") ?? fallbackName,
        description: getFrontmatterValue(frontmatter, "description"),
        model: getFrontmatterValue(frontmatter, "model"),
        tools: getFrontmatterValue(frontmatter, "tools"),
        systemPromptMode: systemPromptMode === "replace"
            ? "replace"
            : systemPromptMode === "append"
                ? "append"
                : undefined,
        skills: getFrontmatterValue(frontmatter, "skills") ??
            getFrontmatterValue(frontmatter, "skill"),
        thinking: thinking && isThinkingLevel(thinking) ? thinking : undefined,
        denyTools: getFrontmatterValue(frontmatter, "deny-tools"),
        spawning: parseOptionalBoolean(getFrontmatterValue(frontmatter, "spawning")),
        selfSpawn: parseOptionalBoolean(getFrontmatterValue(frontmatter, "self-spawn")),
        persistent: parseOptionalBoolean(getFrontmatterValue(frontmatter, "persistent")),
        autoExit: parseOptionalBoolean(getFrontmatterValue(frontmatter, "auto-exit")),
        interactive: parseOptionalBoolean(getFrontmatterValue(frontmatter, "interactive")),
        sessionMode: parseSessionMode(getFrontmatterValue(frontmatter, "session-mode")),
        cwd: getFrontmatterValue(frontmatter, "cwd"),
        body: body || undefined,
        disableModelInvocation: getFrontmatterValue(frontmatter, "disable-model-invocation")?.toLowerCase() === "true",
    };
}
function invalidCapabilityDeclarationDiagnostic(content, agentName, path) {
    const match = content.match(/^---\n([\s\S]*?)\n---/);
    if (!match)
        return null;
    const resolvedAgentName = getFrontmatterValue(match[1], "name") ?? agentName;
    const error = validateCapabilityDeclarations(match[1]);
    if (!error)
        return null;
    return {
        code: "invalid-capability-declaration",
        message: `Role "${resolvedAgentName}" has an invalid capability declaration in ${path}: ${error} Use documented comma-separated tools or deny-tools values, true or false for spawning or self-spawn, or omit the field.`,
        path,
        agentName: resolvedAgentName,
    };
}
function legacyExternalCliDiagnostic(content, agentName, path) {
    const match = content.match(/^---\n([\s\S]*?)\n---/);
    const cli = match ? getFrontmatterValue(match[1], "cli") : undefined;
    if (!match || !cli)
        return null;
    const resolvedAgentName = getFrontmatterValue(match[1], "name") ?? agentName;
    return {
        code: "external-cli-unsupported",
        message: `Role "${resolvedAgentName}" requests external CLI "${cli}" in ${path}. pi-herdr-agents is Pi-only; remove the cli and cli-model fields and select Claude through an authenticated Pi provider/model ID.`,
        path,
        agentName: resolvedAgentName,
    };
}
function listMarkdownFiles(path) {
    const stat = statSync(path);
    if (stat.isFile())
        return path.endsWith(".md") ? [path] : [];
    if (!stat.isDirectory())
        return [];
    return readdirSync(path)
        .filter((entry) => entry.endsWith(".md"))
        .sort((left, right) => left.localeCompare(right))
        .map((entry) => join(path, entry));
}
function findPackageMetadata(path) {
    let current = statSync(path).isDirectory() ? path : dirname(path);
    while (true) {
        const packagePath = join(current, "package.json");
        if (existsSync(packagePath)) {
            try {
                const pkg = JSON.parse(readFileSync(packagePath, "utf8"));
                return {
                    provider: isString(pkg.name) ? pkg.name : undefined,
                    providerVersion: isString(pkg.version) ? pkg.version : undefined,
                };
            }
            catch {
                return {};
            }
        }
        const parent = dirname(current);
        if (parent === current)
            return {};
        current = parent;
    }
}
export function discoverRolePackPaths(onRolePackDiscovered) {
    const paths = new Set();
    const diagnostics = [];
    if (!onRolePackDiscovered)
        return { paths: [], diagnostics };
    try {
        onRolePackDiscovered({
            apiVersion: 1,
            register(path) {
                if (!isString(path) || !isAbsolute(path)) {
                    diagnostics.push({
                        code: "invalid-role-pack-path",
                        message: "Role packs must register an absolute file or directory path.",
                    });
                    return;
                }
                paths.add(resolve(path));
            },
        });
    }
    catch (error) {
        diagnostics.push({
            code: "role-pack-discovery-failed",
            message: `Role-pack discovery failed: ${error instanceof Error ? error.message : String(error)}`,
        });
    }
    return { paths: [...paths], diagnostics };
}
export function discoverAgentCatalog(options) {
    const agents = new Map();
    const diagnostics = [];
    const addDirectory = (path, source) => {
        if (!existsSync(path))
            return;
        for (const filePath of listMarkdownFiles(path)) {
            const fallbackName = basename(filePath, ".md");
            let content;
            try {
                content = normalizeRoleText(readFileSync(filePath, "utf8"));
            }
            catch (error) {
                agents.delete(fallbackName);
                diagnostics.push({
                    code: "unreadable-role-definition",
                    message: `Cannot read role definition ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
                    path: filePath,
                    agentName: fallbackName,
                });
                continue;
            }
            const legacyDiagnostic = legacyExternalCliDiagnostic(content, fallbackName, filePath);
            if (legacyDiagnostic) {
                diagnostics.push(legacyDiagnostic);
                agents.delete(legacyDiagnostic.agentName ?? fallbackName);
                continue;
            }
            const capabilityDiagnostic = invalidCapabilityDeclarationDiagnostic(content, fallbackName, filePath);
            if (capabilityDiagnostic) {
                diagnostics.push(capabilityDiagnostic);
                agents.delete(capabilityDiagnostic.agentName ?? fallbackName);
                continue;
            }
            const parsed = parseAgentDefinition(content, fallbackName);
            if (!parsed) {
                agents.delete(fallbackName);
                diagnostics.push({
                    code: "invalid-role-definition",
                    message: `Role definition must start with frontmatter: ${filePath}`,
                    path: filePath,
                    agentName: fallbackName,
                });
            }
            else
                agents.set(parsed.name, {
                    ...parsed,
                    source,
                    path: filePath,
                    role: runtimeRole(parsed, source),
                });
        }
    };
    // Registered role packs are the entire package layer; the host ships no roles.
    const discovered = discoverRolePackPaths(options.onRolePackDiscovered);
    diagnostics.push(...discovered.diagnostics);
    const contributed = new Map();
    for (const registeredPath of discovered.paths) {
        if (!existsSync(registeredPath)) {
            diagnostics.push({
                code: "missing-role-pack-path",
                message: `Registered role-pack path does not exist: ${registeredPath}`,
                path: registeredPath,
            });
            continue;
        }
        let metadata;
        let roleFiles;
        try {
            metadata = findPackageMetadata(registeredPath);
            roleFiles = listMarkdownFiles(registeredPath);
        }
        catch (error) {
            diagnostics.push({
                code: "unreadable-role-pack-path",
                message: `Cannot read registered role-pack path ${registeredPath}: ${error instanceof Error ? error.message : String(error)}`,
                path: registeredPath,
            });
            continue;
        }
        if (roleFiles.length === 0 && statSync(registeredPath).isFile()) {
            diagnostics.push({
                code: "invalid-role-pack-file",
                message: `Registered role-pack file must use the .md extension: ${registeredPath}`,
                path: registeredPath,
                provider: metadata.provider,
            });
            continue;
        }
        for (const filePath of roleFiles) {
            const fallbackName = basename(filePath, ".md");
            let content;
            try {
                content = normalizeRoleText(readFileSync(filePath, "utf8"));
            }
            catch (error) {
                diagnostics.push({
                    code: "unreadable-role-definition",
                    message: `Cannot read role definition ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
                    path: filePath,
                    agentName: fallbackName,
                    provider: metadata.provider,
                });
                continue;
            }
            const legacyDiagnostic = legacyExternalCliDiagnostic(content, fallbackName, filePath);
            if (legacyDiagnostic) {
                diagnostics.push({ ...legacyDiagnostic, provider: metadata.provider });
                continue;
            }
            const capabilityDiagnostic = invalidCapabilityDeclarationDiagnostic(content, fallbackName, filePath);
            if (capabilityDiagnostic) {
                diagnostics.push({
                    ...capabilityDiagnostic,
                    provider: metadata.provider,
                });
                continue;
            }
            const parsed = parseAgentDefinition(content, fallbackName);
            if (!parsed) {
                diagnostics.push({
                    code: "invalid-role-definition",
                    message: `Role definition must start with frontmatter: ${filePath}`,
                    path: filePath,
                    agentName: fallbackName,
                    provider: metadata.provider,
                });
                continue;
            }
            if (parsed.name !== fallbackName) {
                diagnostics.push({
                    code: "role-name-mismatch",
                    message: `Role name "${parsed.name}" must match filename "${fallbackName}" in ${filePath}`,
                    path: filePath,
                    agentName: fallbackName,
                    provider: metadata.provider,
                });
                continue;
            }
            if (!parsed.description) {
                diagnostics.push({
                    code: "missing-role-description",
                    message: `Role "${parsed.name}" must declare a description in ${filePath}`,
                    path: filePath,
                    agentName: parsed.name,
                    provider: metadata.provider,
                });
                continue;
            }
            const definitions = contributed.get(parsed.name) ?? [];
            definitions.push({
                ...parsed,
                source: "package",
                path: filePath,
                ...metadata,
                role: runtimeRole(parsed, "package", metadata.providerVersion),
            });
            contributed.set(parsed.name, definitions);
        }
    }
    for (const [name, definitions] of contributed) {
        if (definitions.length > 1) {
            const providers = definitions
                .map((definition) => definition.provider ?? definition.path)
                .sort((left, right) => left.localeCompare(right))
                .join(", ");
            diagnostics.push({
                code: "duplicate-package-role",
                message: `Role "${name}" is contributed by multiple role packs: ${providers}. It stays unavailable until only one pack provides it; use a global or project definition for an intentional override.`,
                agentName: name,
            });
            continue;
        }
        agents.set(name, definitions[0]);
    }
    addDirectory(join(options.agentConfigDir, "agents"), "global");
    addDirectory(join(options.cwd, ".pi", "agents"), "project");
    return { agents: [...agents.values()], diagnostics };
}
export function discoverAgentDefinitions(options) {
    return discoverAgentCatalog(options).agents;
}
//# sourceMappingURL=discovery.js.map