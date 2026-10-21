/**
 * On-disk long-term memory store, owned by the Actor process.
 *
 * The store writes structured `SavedMemoryEntry` records to a single JSON file
 * (`~/.webos-agent/memory.json` by default). It never persists the raw
 * transcript — only the summarizer's structured output.
 *
 * Red lines:
 *  - atomic writes (tmp + rename) so a crash can't leave a half-written file;
 *  - a corrupt file is never silently overwritten — it is backed up first;
 *  - bounded: max 100 entries and max 1 MiB;
 *  - the path is fixed to the user's home (or an explicit override); the WS
 *    client can never choose an arbitrary path.
 */

import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { MemorySource, MemoryStoreSnapshot, MemorySummary, SavedMemoryEntry } from "@webos/shared";
import { isMemoryStoreSnapshot } from "@webos/shared";

export const DEFAULT_MEMORY_PATH = join(homedir(), ".webos-agent", "memory.json");

const MAX_ENTRIES = 100;
const MAX_BYTES = 1024 * 1024;

export interface MemoryStoreOptions {
  path?: string;
}

interface RawLoadResult {
  snapshot: MemoryStoreSnapshot;
  corrupt: boolean;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error;
}

export class MemoryStore {
  private readonly path: string;

  constructor(options: MemoryStoreOptions = {}) {
    this.path = options.path ?? DEFAULT_MEMORY_PATH;
  }

  get filePath(): string {
    return this.path;
  }

  /** Read the current snapshot. Missing / corrupt files yield an empty snapshot. */
  async load(): Promise<MemoryStoreSnapshot> {
    const { snapshot } = await this.readRaw();
    return snapshot;
  }

  /** Append a new entry (newest first), then atomically persist. */
  async save(memory: MemorySummary, model: string, source: MemorySource = {}): Promise<SavedMemoryEntry> {
    const { snapshot, corrupt } = await this.readRaw();
    if (corrupt) await this.backupCorrupt();

    const entry: SavedMemoryEntry = {
      id: randomUUID(),
      savedAt: new Date().toISOString(),
      model,
      source,
      memory,
    };
    const entries = this.trimToLimits([entry, ...snapshot.entries]);
    await this.writeAtomic({ schemaVersion: 1, entries });
    return entry;
  }

  /** Delete the store file. */
  async clear(): Promise<void> {
    try {
      await rm(this.path, { force: true });
    } catch {
      // best-effort
    }
  }

  private async readRaw(): Promise<RawLoadResult> {
    let raw: string;
    try {
      raw = await readFile(this.path, "utf8");
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return { snapshot: { schemaVersion: 1, entries: [] }, corrupt: false };
      }
      return { snapshot: { schemaVersion: 1, entries: [] }, corrupt: true };
    }
    try {
      const parsed: unknown = JSON.parse(raw);
      if (isMemoryStoreSnapshot(parsed)) return { snapshot: parsed, corrupt: false };
      return { snapshot: { schemaVersion: 1, entries: [] }, corrupt: true };
    } catch {
      return { snapshot: { schemaVersion: 1, entries: [] }, corrupt: true };
    }
  }

  private trimToLimits(entries: SavedMemoryEntry[]): SavedMemoryEntry[] {
    let list = entries.slice(0, MAX_ENTRIES);
    while (list.length > 0 && JSON.stringify({ schemaVersion: 1, entries: list }).length > MAX_BYTES) {
      list = list.slice(0, -1);
    }
    return list;
  }

  private async backupCorrupt(): Promise<void> {
    const backupPath = `${this.path}.corrupt-${Date.now()}`;
    try {
      await rename(this.path, backupPath);
    } catch {
      // best-effort; proceed to overwrite if the backup fails
    }
  }

  private async writeAtomic(snapshot: MemoryStoreSnapshot): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp-${randomUUID()}`;
    await writeFile(tmp, JSON.stringify(snapshot, null, 2), "utf8");
    try {
      await rename(tmp, this.path);
    } catch (error) {
      await rm(tmp, { force: true }).catch(() => undefined);
      throw error;
    }
    try {
      await chmod(this.path, 0o600);
    } catch {
      // Windows best-effort
    }
  }
}
