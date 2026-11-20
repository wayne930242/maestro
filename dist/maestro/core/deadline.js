/** A finite monotonic budget. Zero is never passed to Node's unlimited timeout. */
export class Deadline {
    end;
    now;
    constructor(end, now) {
        this.end = end;
        this.now = now;
    }
    static after(timeoutMs, now = () => performance.now()) {
        if (!Number.isFinite(timeoutMs) ||
            timeoutMs <= 0 ||
            timeoutMs > 2_147_483_647)
            throw new Error("Timeout must be finite and positive (at most 2147483647ms)");
        return new Deadline(now() + timeoutMs, now);
    }
    remainingMs() {
        const remaining = this.end - this.now();
        if (remaining <= 0)
            throw new Error("Operation deadline exceeded");
        return Math.ceil(remaining);
    }
    expired() {
        return this.now() >= this.end;
    }
    cappedAt(timeoutMs) {
        const cap = Deadline.after(timeoutMs, this.now);
        return new Deadline(Math.min(this.end, cap.end), this.now);
    }
}
//# sourceMappingURL=deadline.js.map