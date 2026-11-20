import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isFiniteNumber, isRecord } from "./type-guards.js";
export const DEFAULT_MAX_PERSISTENT_AGENTS = 3;
function invalidPersistentConfig(source, message) {
    throw new Error(`Invalid persistent specialist config in ${source}: ${message}`);
}
export function parsePersistentConfig(rawConfig, source = "config.json") {
    if (!isRecord(rawConfig)) {
        invalidPersistentConfig(source, "root must be an object");
    }
    if (!Object.hasOwn(rawConfig, "persistent")) {
        return { maxAgents: DEFAULT_MAX_PERSISTENT_AGENTS };
    }
    if (!isRecord(rawConfig.persistent)) {
        invalidPersistentConfig(source, "persistent must be an object");
    }
    const unsupported = Object.keys(rawConfig.persistent).filter((key) => key !== "maxAgents");
    if (unsupported.length > 0) {
        invalidPersistentConfig(source, `persistent has unsupported key(s): ${unsupported.join(", ")}`);
    }
    if (!Object.hasOwn(rawConfig.persistent, "maxAgents")) {
        return { maxAgents: DEFAULT_MAX_PERSISTENT_AGENTS };
    }
    const { maxAgents } = rawConfig.persistent;
    if (!isFiniteNumber(maxAgents) ||
        !Number.isInteger(maxAgents) ||
        maxAgents < 1) {
        invalidPersistentConfig(source, "persistent.maxAgents must be a positive integer");
    }
    return { maxAgents };
}
function readPersistentConfigFile(configPath, examplePath) {
    try {
        return {
            sourcePath: configPath,
            rawConfig: readFileSync(configPath, "utf8"),
        };
    }
    catch (error) {
        // SAFETY: readFileSync only throws Node fs errors here, which carry code.
        if (error.code !== "ENOENT")
            throw error;
    }
    try {
        return {
            sourcePath: examplePath,
            rawConfig: readFileSync(examplePath, "utf8"),
        };
    }
    catch (error) {
        // SAFETY: readFileSync only throws Node fs errors here, which carry code.
        if (error.code === "ENOENT") {
            throw new Error(`Missing persistent specialist config. Expected ${configPath} or ${examplePath}.`);
        }
        throw error;
    }
}
export function loadPersistentConfig(configDir, examplePath) {
    const configPath = join(configDir, "config.json");
    const { sourcePath, rawConfig } = readPersistentConfigFile(configPath, examplePath);
    let parsed;
    try {
        parsed = JSON.parse(rawConfig);
    }
    catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        throw new Error(`Invalid JSON in subagent config ${sourcePath}: ${detail}`);
    }
    return parsePersistentConfig(parsed, sourcePath);
}
//# sourceMappingURL=persistent-config.js.map