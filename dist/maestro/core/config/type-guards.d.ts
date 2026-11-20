/**
 * Runtime predicates for validating values read from an I/O boundary
 * (JSON files, subprocess output, CLI responses) before they are trusted
 * as a concrete domain type. Callers pass the raw, unvalidated value
 * (typed `any` at the boundary, matching `JSON.parse`'s own return type)
 * and receive a boolean verdict instead of narrowing with `typeof`.
 */
/** A JSON object whose undefined properties are omitted by JSON.stringify. */
export type JsonObject = {
    [key: string]: JsonValue | undefined;
};
/** A JSON-serializable value, for freeform log/session/telemetry payloads. */
export type JsonValue = null | boolean | number | string | JsonValue[] | JsonObject;
export declare function isString(value: any): value is string;
export declare function isNonEmptyString(value: any): value is string;
export declare function isFiniteNumber(value: any): value is number;
export declare function isBoolean(value: any): value is boolean;
/** A callable, including async and generator functions. */
export declare function isFunction(value: any): value is (...args: any[]) => any;
export declare function isPlainObject(value: any): boolean;
export declare function isRecord(value: any): value is JsonObject;
//# sourceMappingURL=type-guards.d.ts.map