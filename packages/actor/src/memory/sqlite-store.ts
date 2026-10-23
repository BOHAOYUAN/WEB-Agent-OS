/**
 * SQLite-backed long-term memory store, owned by the Actor process.
 *
 * Replaces the JSON store (`store.ts`) with the same public surface
 * (`load` / `save` / `clear` / `filePath`) so the CLI and the extension keep
 * working unchanged. Uses Node's built-in `node:sqlite` — ZERO new dependencies,
 * which is a project red line. Verified by `scripts/verify-sqlite.mjs`
 * (Node 22.22.2, no flag required, WAL supported).
 *
 * Red lines, carried over from the JSON store and extended:
 *  - the database path is fixed under the user's home (or an explicit
 *    override); the WS client can never choose an arbitrary path;
 *  - bounded: `episodes` keeps the newest MAX_ENTRIES rows;
 *  - a corrupt database is renamed aside, never silently overwritten — the
 *    same behaviour as `MemoryStore.backupCorrupt()`;
 *  - only structured summaries are persisted, never raw transcripts.
 */

import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { mkdirSync, chmodSync } from "node:fs";
import { rename, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { MemorySource, MemoryStoreSnapshot, MemorySummary, SavedMemoryEntry } from "@webos/shared";
import { isMemorySummary } from "@webos/shared";

export const DEFAULT_SQLITE_PATH = join(homedir(), ".webos-agent", "memory.db");

/**
 * `node:sqlite` landed in Node 22.5 and is absent from Vite 5's builtin-module
 * list, so a static `import { DatabaseSync } from "node:sqlite"` is resolved as
 * a package called "sqlite" and fails to load under vitest. Load it through
 * `createRequire` until Vite is upgraded — `typeof import(...)` keeps the types.
 */
const require = createRequire(import.meta.url);
const sqlite = require("node:sqlite") as typeof import("node:sqlite");
const DatabaseSync = sqlite.DatabaseSync;
/** The class is only available as a value here, so derive the instance type. */
type Database = InstanceType<typeof DatabaseSync>;

/** Matches the JSON store's cap so behaviour does not change on migration. */
const MAX_ENTRIES = 100;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  tab_id INTEGER,
  site TEXT,
  started_at TEXT,
  summary TEXT,
  source_json TEXT
);
CREATE TABLE IF NOT EXISTS facts (
  id TEXT PRIMARY KEY,
  kind TEXT,
  key TEXT NOT NULL UNIQUE,
  value TEXT,
  confidence REAL,
  updated_at TEXT
);
CREATE TABLE IF NOT EXISTS episodes (
  id TEXT PRIMARY KEY,
  saved_at TEXT,
  model TEXT,
  source_json TEXT,
  memory_json TEXT
);
CREATE INDEX IF NOT EXISTS idx_episodes_saved_at ON episodes(saved_at);
CREATE INDEX IF NOT EXISTS idx_facts_key ON facts(key);
`;

export interface SqliteMemoryStoreOptions {
  path?: string;
}

export interface MemoryFact {
  id: string;
  kind: string;
  key: string;
  value: string;
  confidence: number | null;
  updatedAt: string;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error;
}

export class SqliteMemoryStore {
  private readonly path: string;
  private db: Database | null = null;

  constructor(options: SqliteMemoryStoreOptions = {}) {
    this.path = options.path ?? DEFAULT_SQLITE_PATH;
  }

  get filePath(): string {
    return this.path;
  }

  /** Open lazily so constructing the store never touches the disk. */
  private connect(): Database {
    if (this.db) return this.db;
    try {
      mkdirSync(dirname(this.path), { recursive: true });
    } catch {
      // Best-effort: the directory usually already exists.
    }
    try {
      this.db = new DatabaseSync(this.path);
    } catch (error) {
      throw new Error(`无法打开记忆数据库：${error instanceof Error ? error.message : String(error)}`);
    }
    try {
      chmodSync(this.path, 0o600);
    } catch {
      // Windows best-effort; the JSON store had the same caveat.
    }
    try {
      this.db.exec("PRAGMA journal_mode = WAL");
      this.db.exec("PRAGMA foreign_keys = ON");
      this.db.exec(SCHEMA);
    } catch (error) {
      this.close();
      throw error;
    }
    return this.db;
  }

  close(): void {
    try {
      this.db?.close();
    } catch {
      // Closing twice must not throw.
    }
    this.db = null;
  }

  /** Read the newest entries, newest first. */
  load(): MemoryStoreSnapshot {
    const db = this.connect();
    const rows = db
      .prepare("SELECT id, saved_at, model, source_json, memory_json FROM episodes ORDER BY saved_at DESC LIMIT ?")
      .all(MAX_ENTRIES) as { id: string; saved_at: string; model: string; source_json: string | null; memory_json: string }[];

    const entries: SavedMemoryEntry[] = [];
    for (const row of rows) {
      const memory = parseMemory(row.memory_json);
      if (!memory) continue;
      entries.push({
        id: row.id,
        savedAt: row.saved_at,
        model: row.model,
        source: parseSource(row.source_json),
        memory,
      });
    }
    return { schemaVersion: 1, entries };
  }

  /** Append an entry, then trim to the cap. */
  save(memory: MemorySummary, model: string, source: MemorySource = {}): SavedMemoryEntry {
    const db = this.connect();
    const entry: SavedMemoryEntry = {
      id: randomUUID(),
      savedAt: new Date().toISOString(),
      model,
      source,
      memory,
    };
    db.exec("BEGIN");
    try {
      db.prepare(
        "INSERT INTO episodes (id, saved_at, model, source_json, memory_json) VALUES (?, ?, ?, ?, ?)",
      ).run(entry.id, entry.savedAt, model, JSON.stringify(source), JSON.stringify(memory));
      db.prepare(
        `DELETE FROM episodes WHERE id NOT IN (
           SELECT id FROM episodes ORDER BY saved_at DESC LIMIT ?
         )`,
      ).run(MAX_ENTRIES);
      db.exec("COMMIT");
    } catch (error) {
      try {
        db.exec("ROLLBACK");
      } catch {
        // The transaction may already be dead; surface the original error.
      }
      throw error;
    }
    return entry;
  }

  /** Delete the database file (and its WAL sidecars). */
  async clear(): Promise<void> {
    this.close();
    await rm(this.path, { force: true });
    await rm(`${this.path}-wal`, { force: true });
    await rm(`${this.path}-shm`, { force: true });
  }

  /**
   * Rename the database aside. Used when the file is unreadable, mirroring
   * `MemoryStore.backupCorrupt()` — a corrupt store is never silently dropped.
   */
  async quarantine(reason: string): Promise<string | null> {
    this.close();
    const target = `${this.path}.corrupt-${Date.now()}`;
    try {
      await rename(this.path, target);
      return target;
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") return null;
      throw new Error(`无法隔离损坏的记忆数据库（${reason}）`);
    }
  }

  /**
   * Import a legacy `memory.json` snapshot. Idempotent: `INSERT OR REPLACE`
   * keyed on the entry id, so re-running is safe.
   */
  migrateFromSnapshot(snapshot: MemoryStoreSnapshot): number {
    const db = this.connect();
    const stmt = db.prepare(
      `INSERT OR REPLACE INTO episodes (id, saved_at, model, source_json, memory_json)
       VALUES (?, ?, ?, ?, ?)`,
    );
    let imported = 0;
    db.exec("BEGIN");
    try {
      for (const entry of snapshot.entries) {
        stmt.run(entry.id, entry.savedAt, entry.model, JSON.stringify(entry.source ?? {}), JSON.stringify(entry.memory));
        imported += 1;
      }
      db.exec("COMMIT");
    } catch (error) {
      try {
        db.exec("ROLLBACK");
      } catch {
        /* ignore */
      }
      throw error;
    }
    return imported;
  }

  /** Upsert a durable fact (preference / project convention / profile). */
  upsertFact(kind: string, key: string, value: string, confidence: number | null = null): MemoryFact {
    const db = this.connect();
    const id = randomUUID();
    const updatedAt = new Date().toISOString();
    db.prepare(
      `INSERT INTO facts (id, kind, key, value, confidence, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET
         kind = excluded.kind,
         value = excluded.value,
         confidence = excluded.confidence,
         updated_at = excluded.updated_at`,
    ).run(id, kind, key, value, confidence, updatedAt);
    return { id, kind, key, value, confidence, updatedAt };
  }

  /** Read facts, optionally filtered by kind, newest first. */
  queryFacts(kind?: string, limit = 50): MemoryFact[] {
    const db = this.connect();
    const rows = (
      kind === undefined
        ? db.prepare("SELECT id, kind, key, value, confidence, updated_at FROM facts ORDER BY updated_at DESC LIMIT ?").all(limit)
        : db
            .prepare(
              "SELECT id, kind, key, value, confidence, updated_at FROM facts WHERE kind = ? ORDER BY updated_at DESC LIMIT ?",
            )
            .all(kind, limit)
    ) as { id: string; kind: string; key: string; value: string; confidence: number | null; updated_at: string }[];
    return rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      key: row.key,
      value: row.value,
      confidence: row.confidence,
      updatedAt: row.updated_at,
    }));
  }
}

function parseMemory(json: string): MemorySummary | null {
  try {
    const parsed: unknown = JSON.parse(json);
    return isMemorySummary(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function parseSource(json: string | null): MemorySource {
  if (!json) return {};
  try {
    const parsed: unknown = JSON.parse(json);
    if (typeof parsed === "object" && parsed !== null) return parsed as MemorySource;
    return {};
  } catch {
    return {};
  }
}

/**
 * Synchronous mkdir. `connect()` runs on the caller's hot path, so it cannot
 * await — the JSON store had the same shape (writeAtomic created the dir).
 */
