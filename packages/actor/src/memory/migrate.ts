/**
 * One-way migration from the legacy `memory.json` store to SQLite.
 *
 * Deliberately conservative:
 *  - never deletes or renames the source file — the user decides when to drop
 *    it, which matches the existing "a corrupt store is never silently
 *    dropped" red line;
 *  - idempotent: re-running imports the same ids via `INSERT OR REPLACE`, so a
 *    half-finished migration can simply be retried;
 *  - a missing or empty source is a no-op, not an error.
 */

import { existsSync } from "node:fs";
import { MemoryStore, DEFAULT_MEMORY_PATH } from "./store.js";
import { SqliteMemoryStore, DEFAULT_SQLITE_PATH } from "./sqlite-store.js";

export interface MigrationResult {
  imported: number;
  jsonPath: string;
  sqlitePath: string;
  /** True when there was nothing to import (no file, or zero entries). */
  skipped: boolean;
  reason?: string;
}

export interface MigrationOptions {
  jsonPath?: string;
  sqlitePath?: string;
}

/**
 * True when a first-run migration is worth attempting: legacy file present,
 * target database not yet created.
 */
export function needsMigration(
  jsonPath: string = DEFAULT_MEMORY_PATH,
  sqlitePath: string = DEFAULT_SQLITE_PATH,
): boolean {
  return existsSync(jsonPath) && !existsSync(sqlitePath);
}

/** Import a legacy snapshot into SQLite. Safe to run repeatedly. */
export async function migrateJsonToSqlite(options: MigrationOptions = {}): Promise<MigrationResult> {
  const jsonPath = options.jsonPath ?? DEFAULT_MEMORY_PATH;
  const sqlitePath = options.sqlitePath ?? DEFAULT_SQLITE_PATH;

  if (!existsSync(jsonPath)) {
    return { imported: 0, jsonPath, sqlitePath, skipped: true, reason: "未找到 memory.json" };
  }

  const legacy = new MemoryStore({ path: jsonPath });
  // `loadWithStatus`, not `load`: a corrupt source must be reported as such,
  // not quietly mistaken for an empty one.
  const { snapshot, corrupt } = await legacy.loadWithStatus();

  if (corrupt) {
    return {
      imported: 0,
      jsonPath,
      sqlitePath,
      skipped: true,
      reason: "memory.json 损坏或无法解析，已跳过迁移（原文件保留）",
    };
  }

  if (snapshot.entries.length === 0) {
    return { imported: 0, jsonPath, sqlitePath, skipped: true, reason: "memory.json 为空" };
  }

  const target = new SqliteMemoryStore({ path: sqlitePath });
  try {
    const imported = target.migrateFromSnapshot(snapshot);
    return { imported, jsonPath, sqlitePath, skipped: false };
  } finally {
    target.close();
  }
}
