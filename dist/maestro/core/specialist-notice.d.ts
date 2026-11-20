/**
 * Bounds for persistent-specialist notices (ADR-0019). The parent's checks
 * decide; the child's stricter checks only spare a compliant child a drop.
 */
/** Notices the parent delivers per specialist generation. */
export declare const NOTICE_CAP = 50;
/** The child tool refuses a notice sooner than this after its previous one. */
export declare const NOTICE_CHILD_INTERVAL_MS = 30000;
/** The parent drops, and counts, a notice sooner than this after the last delivered one. */
export declare const NOTICE_PARENT_INTERVAL_MS = 15000;
/** Bound for the encoded notice message in the parent's host line. */
export declare const NOTICE_MESSAGE_CHARS = 4000;
/** Parent-owned notice accounting for one specialist generation. */
export interface NoticeBudget {
    delivered: number;
    /** Notices dropped by the rate limit and not yet reported to the parent. */
    unreported: number;
    /** Parent clock of the last delivered notice. */
    lastAt?: number;
}
/** Refuse notices for a non-persistent run before any resource exists. */
export declare function notifyLaunchRefusal(behavior: {
    persistent: boolean;
    notify?: boolean;
}): string | undefined;
export type NoticeAdmission = "deliver" | "rate-limited" | "capped";
export declare function admitNotice(budget: NoticeBudget, now: number): NoticeAdmission;
/**
 * The child's own refusal before it records a notice, from the notices this
 * generation already recorded; `undefined` means it may send.
 */
export declare function childNoticeRefusal(previous: {
    sent: number;
    lastAt?: number;
}, now: number): string | undefined;
//# sourceMappingURL=specialist-notice.d.ts.map