/**
 * The contract every memory backend satisfies.
 *
 * `load` / `save` may be sync or async: the SQLite backend is synchronous
 * (better-sqlite3-style `node:sqlite` API) while the JSON backend is async.
 * Callers must `await` either way, which makes the two interchangeable.
 *
 * `close` is optional because a JSON file needs no teardown, but a database
 * connection does — and on Windows an unclosed handle keeps the file locked.
 */

import type { MemorySource, MemoryStoreSnapshot, MemorySummary, SavedMemoryEntry } from "@webos/shared";

export interface MemoryStoreLike {
  readonly filePath: string;
  load(): MemoryStoreSnapshot | Promise<MemoryStoreSnapshot>;
  save(
    memory: MemorySummary,
    model: string,
    source?: MemorySource,
  ): SavedMemoryEntry | Promise<SavedMemoryEntry>;
  clear(): Promise<void>;
  /** Release OS resources. Optional; a no-op for backends that need none. */
  close?(): void;
}

export type MemoryBackend = "sqlite" | "json";
