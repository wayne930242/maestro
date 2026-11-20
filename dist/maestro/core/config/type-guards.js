/**
 * Runtime predicates for validating values read from an I/O boundary
 * (JSON files, subprocess output, CLI responses) before they are trusted
 * as a concrete domain type. Callers pass the raw, unvalidated value
 * (typed `any` at the boundary, matching `JSON.parse`'s own return type)
 * and receive a boolean verdict instead of narrowing with `typeof`.
 */
export function isString(value) {
    return Object.prototype.toString.call(value) === "[object String]";
}
export function isNonEmptyString(value) {
    return isString(value) && value.length > 0;
}
export function isFiniteNumber(value) {
    return Number.isFinite(value);
}
export function isBoolean(value) {
    return value === true || value === false;
}
/** A callable, including async and generator functions. */
export function isFunction(value) {
    return value instanceof Function;
}
export function isPlainObject(value) {
    return isRecord(value);
}
export function isRecord(value) {
    return (value !== null &&
        Object.prototype.toString.call(value) === "[object Object]");
}
//# sourceMappingURL=type-guards.js.map