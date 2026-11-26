/**
 * weihung fork: which @nubl/maestro build this process loaded. A host writes it
 * into its load stamp so a doctor can tell a stale load (the process runs an
 * older build than the one installed) from a fresh one without importing
 * maestro itself.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
let cached;
/**
 * Walks up from this module to the `@nubl/maestro` package.json, so the answer
 * is the same from source (`maestro/`) and from the build (`dist/maestro/`).
 * Throws when no such package.json is above it.
 */
export function maestroBuildInfo() {
    if (cached)
        return cached;
    const start = dirname(fileURLToPath(import.meta.url));
    for (let dir = start;; dir = dirname(dir)) {
        const pkg = readPackage(join(dir, "package.json"));
        if (pkg?.name === "@nubl/maestro") {
            if (!pkg.version)
                throw new Error(`@nubl/maestro: ${dir} has no version`);
            cached = Object.freeze({ version: pkg.version, root: dir });
            return cached;
        }
        if (dirname(dir) === dir)
            throw new Error(`@nubl/maestro: no package.json above ${start}`);
    }
}
function readPackage(file) {
    try {
        return JSON.parse(readFileSync(file, "utf8"));
    }
    catch {
        return undefined;
    }
}
//# sourceMappingURL=build-info.js.map