/**
 * Resolve symbolic links with lstat, stat, and readlink only, matching Node's
 * JavaScript realpathSync, including its lexical `..` handling. Bun's
 * realpathSync opens the path, and open() blocks indefinitely on some
 * protected macOS directories, such as another app's sandbox container,
 * freezing the whole process.
 */
export declare function realpathWithoutOpening(path: string): string;
//# sourceMappingURL=realpath-without-opening.d.ts.map