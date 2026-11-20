import { watch } from "node:fs";
import { basename, dirname } from "node:path";
/**
 * Shares directory watches between supervised sessions. Sidecars use atomic
 * rename and task events use appendFileSync, so directories are watched deliberately.
 */
export class FileWakeRegistry {
    directories = new Map();
    watchDirectory;
    closed = false;
    retained = 0;
    constructor(watchDirectory = watch) {
        this.watchDirectory = watchDirectory;
    }
    register(sessionFile, wake, fallback) {
        const directory = dirname(sessionFile);
        const entry = {
            filenames: new Set([
                `${basename(sessionFile)}.exit`,
                `${basename(sessionFile)}.tasks`,
            ]),
            wake,
            fallback,
        };
        let current = this.directories.get(directory);
        if (!this.closed && !current) {
            try {
                const watcher = this.watchDirectory(directory, (_event, filename) => {
                    if (this.closed)
                        return;
                    for (const watched of current?.entries ?? []) {
                        if (!filename || watched.filenames.has(filename.toString()))
                            watched.wake();
                    }
                });
                current = { watcher, entries: new Set() };
                // Idle watches must not keep the process running. A parked waiter
                // retains them so this callback can still run.
                watcher.unref();
                if (this.retained > 0)
                    watcher.ref();
                watcher.on("error", () => this.failDirectory(directory));
                this.directories.set(directory, current);
            }
            catch {
                // The caller switches this child to polling.
            }
        }
        if (current)
            current.entries.add(entry);
        else
            fallback();
        return {
            watching: current != null,
            unregister: () => {
                const active = this.directories.get(directory);
                if (!active)
                    return;
                active.entries.delete(entry);
                if (active.entries.size === 0) {
                    active.watcher.close();
                    this.directories.delete(directory);
                }
            },
        };
    }
    get watcherCount() {
        return this.directories.size;
    }
    /** Outstanding retains; every directory watch is referenced while nonzero. */
    get retainedWaits() {
        return this.retained;
    }
    /**
     * Pin every active directory watch until the returned function runs.
     * A bare wake promise does not keep the event loop alive, and idle watches
     * are unref'd, so without this the callback never runs when that promise is
     * the only pending work.
     */
    retain() {
        if (this.closed)
            return () => { };
        this.retained++;
        if (this.retained === 1)
            this.applyWatcherRef(true);
        let released = false;
        return () => {
            if (released)
                return;
            released = true;
            if (this.closed || this.retained === 0)
                return;
            this.retained--;
            if (this.retained === 0)
                this.applyWatcherRef(false);
        };
    }
    close() {
        this.closed = true;
        this.retained = 0;
        for (const { watcher } of this.directories.values())
            watcher.close();
        this.directories.clear();
    }
    applyWatcherRef(active) {
        for (const { watcher } of this.directories.values()) {
            if (active)
                watcher.ref();
            else
                watcher.unref();
        }
    }
    failDirectory(directory) {
        if (this.closed)
            return;
        const current = this.directories.get(directory);
        if (!current)
            return;
        this.directories.delete(directory);
        current.watcher.close();
        for (const entry of current.entries)
            entry.fallback();
    }
}
//# sourceMappingURL=wake.js.map