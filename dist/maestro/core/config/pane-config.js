import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isPlainObject, isString } from "./type-guards.js";
export const DEFAULT_MIN_SPLIT_COLS = 80;
function invalidPaneConfig(source, message) {
    throw new Error(`Invalid subagent pane config in ${source}: ${message}`);
}
export function parsePaneConfig(rawConfig, source = "config.json") {
    if (!isPlainObject(rawConfig)) {
        invalidPaneConfig(source, "root must be an object");
    }
    if (!Object.hasOwn(rawConfig, "panes")) {
        return {
            mode: "grouped",
            direction: "right",
            maxPerTab: 4,
            minSplitCols: DEFAULT_MIN_SPLIT_COLS,
        };
    }
    if (!isPlainObject(rawConfig.panes)) {
        invalidPaneConfig(source, "panes must be an object");
    }
    const unsupportedKeys = Object.keys(rawConfig.panes).filter((key) => key !== "mode" &&
        key !== "direction" &&
        key !== "maxPerTab" &&
        key !== "minSplitCols");
    if (unsupportedKeys.length > 0) {
        invalidPaneConfig(source, `panes has unsupported key(s): ${unsupportedKeys.join(", ")}`);
    }
    let mode = "grouped";
    if (Object.hasOwn(rawConfig.panes, "mode")) {
        if (!isString(rawConfig.panes.mode) ||
            (rawConfig.panes.mode !== "grouped" &&
                rawConfig.panes.mode !== "tab" &&
                rawConfig.panes.mode !== "split")) {
            invalidPaneConfig(source, 'panes.mode must be "grouped", "tab", or "split"');
        }
        mode = rawConfig.panes.mode;
    }
    let direction = "right";
    if (Object.hasOwn(rawConfig.panes, "direction")) {
        if (!isString(rawConfig.panes.direction) ||
            (rawConfig.panes.direction !== "right" &&
                rawConfig.panes.direction !== "down")) {
            invalidPaneConfig(source, 'panes.direction must be "right" or "down"');
        }
        direction = rawConfig.panes.direction;
    }
    const maxPerTab = Object.hasOwn(rawConfig.panes, "maxPerTab")
        ? rawConfig.panes.maxPerTab
        : 4;
    if (!Number.isSafeInteger(maxPerTab) || maxPerTab < 1) {
        invalidPaneConfig(source, "panes.maxPerTab must be a positive safe integer");
    }
    const minSplitCols = Object.hasOwn(rawConfig.panes, "minSplitCols")
        ? rawConfig.panes.minSplitCols
        : DEFAULT_MIN_SPLIT_COLS;
    if (!Number.isSafeInteger(minSplitCols) || minSplitCols < 1) {
        invalidPaneConfig(source, "panes.minSplitCols must be a positive safe integer");
    }
    return { mode, direction, maxPerTab, minSplitCols };
}
function readPaneConfigFile(configPath, examplePath) {
    try {
        return {
            sourcePath: configPath,
            rawConfig: readFileSync(configPath, "utf8"),
        };
    }
    catch (error) {
        // SAFETY: readFileSync only throws Node fs errors here, which carry code.
        const errno = error;
        if (errno.code !== "ENOENT")
            throw error;
    }
    try {
        return {
            sourcePath: examplePath,
            rawConfig: readFileSync(examplePath, "utf8"),
        };
    }
    catch (error) {
        // SAFETY: see the preceding readFileSync error handling.
        const errno = error;
        if (errno.code === "ENOENT") {
            throw new Error(`Missing subagent pane config. Expected ${configPath} or ${examplePath}.`);
        }
        throw error;
    }
}
export function loadPaneConfig(configDir, examplePath) {
    const configPath = join(configDir, "config.json");
    const { sourcePath, rawConfig } = readPaneConfigFile(configPath, examplePath);
    let parsed;
    try {
        parsed = JSON.parse(rawConfig);
    }
    catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        throw new Error(`Invalid JSON in subagent config ${sourcePath}: ${detail}`);
    }
    return parsePaneConfig(parsed, sourcePath);
}
export function createSubagentPaneFactory(config, createTab, createSplit, createGrouped) {
    if (config.mode === "grouped") {
        return (name, cwd = process.cwd()) => {
            if (!createGrouped)
                throw new Error("Grouped pane creation is unavailable");
            return createGrouped(name, cwd, config.maxPerTab, config.direction);
        };
    }
    return config.mode === "split"
        ? (name, cwd) => createSplit(name, config.direction, cwd)
        : createTab;
}
//# sourceMappingURL=pane-config.js.map