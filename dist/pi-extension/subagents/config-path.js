import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
export function getAgentConfigDir() {
    return getAgentDir();
}
export function getSubagentsConfigDir() {
    return join(getAgentConfigDir(), "herdr-agents");
}
export function getSubagentsConfigPath() {
    return join(getSubagentsConfigDir(), "config.json");
}
export function getSubagentsConfigExamplePath(assetRoot = PACKAGE_ROOT) {
    return join(assetRoot, "config.json.example");
}
export function getSubagentsPackageRoot() {
    return PACKAGE_ROOT;
}
//# sourceMappingURL=config-path.js.map