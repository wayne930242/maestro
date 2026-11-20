import { describe as nodeDescribe, it as nodeIt } from "node:test";
import type { SurfaceProvider } from "../../maestro/core/surface-provider.ts";
interface TestRunner {
    describe: typeof nodeDescribe;
    it: typeof nodeIt;
}
interface SurfaceProviderFixture {
    provider: SurfaceProvider;
    cwd: string;
    /**
     * Maximum grouped surfaces per provider group. The fixture must provide an
     * empty, isolated grouping space so conformance can count only its surfaces.
     */
    groupingCap?: number;
    dispose(): Promise<void>;
}
export declare function registerSurfaceProviderConformance(runner: TestRunner, name: string, factory: () => Promise<SurfaceProviderFixture>): void;
export declare function hasStandaloneScreenLine(screen: string, needle: string): boolean;
export {};
//# sourceMappingURL=surface-provider.conformance.d.ts.map