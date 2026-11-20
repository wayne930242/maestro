import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isBoolean, isRecord } from "./type-guards.js";
function invalid(source, message) {
    throw new Error(`Invalid outcomeLedger config in ${source}: ${message}`);
}
/** `outcomeLedger` is on unless set to `false`; any non-boolean is rejected. */
export function parseOutcomeLedgerConfig(rawConfig, source = "config.json") {
    if (!isRecord(rawConfig))
        invalid(source, "root must be an object");
    if (!Object.hasOwn(rawConfig, "outcomeLedger"))
        return { enabled: true };
    if (!isBoolean(rawConfig.outcomeLedger))
        invalid(source, "outcomeLedger must be true or false");
    return { enabled: rawConfig.outcomeLedger };
}
export function loadOutcomeLedgerConfig(configDir, examplePath) {
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
            if (exampleError.code === "ENOENT")
                return { enabled: true };
            throw exampleError;
        }
    }
    try {
        return parseOutcomeLedgerConfig(JSON.parse(rawConfig), sourcePath);
    }
    catch (error) {
        if (error instanceof SyntaxError) {
            throw new Error(`Invalid JSON in subagent config ${sourcePath}: ${error.message}`);
        }
        throw error;
    }
}
//# sourceMappingURL=outcome-ledger-config.js.map