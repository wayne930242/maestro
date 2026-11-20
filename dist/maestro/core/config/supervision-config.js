import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isBoolean, isFiniteNumber, isRecord } from "./type-guards.js";
function invalid(source, message) {
    throw new Error(`Invalid subagent supervision config in ${source}: ${message}`);
}
export function parseSupervisionConfig(rawConfig, source = "config.json") {
    if (!isRecord(rawConfig))
        invalid(source, "root must be an object");
    if (!Object.hasOwn(rawConfig, "supervision")) {
        return { forcePolling: false, hangWarningMinutes: 15 };
    }
    if (!isRecord(rawConfig.supervision)) {
        invalid(source, "supervision must be an object");
    }
    const unsupported = Object.keys(rawConfig.supervision).filter((key) => key !== "forcePolling" && key !== "hangWarningMinutes");
    if (unsupported.length > 0) {
        invalid(source, `supervision has unsupported key(s): ${unsupported.join(", ")}`);
    }
    const forcePolling = Object.hasOwn(rawConfig.supervision, "forcePolling")
        ? rawConfig.supervision.forcePolling
        : false;
    if (!isBoolean(forcePolling)) {
        invalid(source, "supervision.forcePolling must be a boolean");
    }
    const hangWarningMinutes = Object.hasOwn(rawConfig.supervision, "hangWarningMinutes")
        ? rawConfig.supervision.hangWarningMinutes
        : 15;
    if (!isFiniteNumber(hangWarningMinutes) ||
        !Number.isInteger(hangWarningMinutes) ||
        hangWarningMinutes < 0) {
        invalid(source, "supervision.hangWarningMinutes must be a non-negative integer");
    }
    return { forcePolling, hangWarningMinutes };
}
export function loadSupervisionConfig(configDir, examplePath) {
    const configPath = join(configDir, "config.json");
    let sourcePath = configPath;
    let rawConfig;
    try {
        rawConfig = readFileSync(configPath, "utf8");
    }
    catch (error) {
        // SAFETY: readFileSync only throws Node fs errors here, which carry code.
        if (error.code !== "ENOENT")
            throw error;
        sourcePath = examplePath;
        try {
            rawConfig = readFileSync(examplePath, "utf8");
        }
        catch (exampleError) {
            // SAFETY: readFileSync only throws Node fs errors here, which carry code.
            if (exampleError.code === "ENOENT") {
                throw new Error(`Missing subagent supervision config. Expected ${configPath} or ${examplePath}.`);
            }
            throw exampleError;
        }
    }
    try {
        return parseSupervisionConfig(JSON.parse(rawConfig), sourcePath);
    }
    catch (error) {
        if (error instanceof SyntaxError) {
            throw new Error(`Invalid JSON in subagent config ${sourcePath}: ${error.message}`);
        }
        throw error;
    }
}
//# sourceMappingURL=supervision-config.js.map