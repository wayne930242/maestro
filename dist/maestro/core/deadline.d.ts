/** A finite monotonic budget. Zero is never passed to Node's unlimited timeout. */
export declare class Deadline {
    private readonly end;
    private readonly now;
    private constructor();
    static after(timeoutMs: number, now?: () => number): Deadline;
    remainingMs(): number;
    expired(): boolean;
    cappedAt(timeoutMs: number): Deadline;
}
//# sourceMappingURL=deadline.d.ts.map