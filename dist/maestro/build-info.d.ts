export interface MaestroBuildInfo {
    /** `version` from the package.json of the loaded package. */
    readonly version: string;
    /** Directory holding that package.json: the source checkout or the install. */
    readonly root: string;
}
/**
 * Walks up from this module to the `@nubl/maestro` package.json, so the answer
 * is the same from source (`maestro/`) and from the build (`dist/maestro/`).
 * Throws when no such package.json is above it.
 */
export declare function maestroBuildInfo(): MaestroBuildInfo;
//# sourceMappingURL=build-info.d.ts.map