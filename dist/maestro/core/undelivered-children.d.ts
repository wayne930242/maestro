/**
 * The process-local slot that holds this process's running-subagent registry.
 * The subagents extension owns and writes it; the child protocol extension
 * only reads it, so both agree on one key without importing each other.
 */
export declare const SUBAGENT_RUNTIME_KEY: unique symbol;
interface RegistryRow {
    persistent?: boolean;
    lifecycle?: {
        delivery?: string;
    };
}
interface RuntimeSlot {
    runningSubagents?: ReadonlyMap<string, RegistryRow>;
}
/**
 * Whether this process launched an ordinary child whose result, help request,
 * or cancellation has not yet been delivered to it.
 *
 * Ordinary completion removes a row just before it sends the result steer, so
 * a row that is still present has not been delivered. A suppressed row will
 * never be delivered and does not count. Persistent specialists stay in the
 * registry by design until they are stopped, so they never count.
 */
export declare function hasUndeliveredChildren(slot?: RuntimeSlot | undefined): boolean;
export {};
//# sourceMappingURL=undelivered-children.d.ts.map