import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { MemorySummary } from "@webos/shared";
import { MemoryStore } from "../src/memory/store.js";
import { SqliteMemoryStore } from "../src/memory/sqlite-store.js";
import { migrateJsonToSqlite, needsMigration } from "../src/memory/migrate.js";

function summary(text: string): MemorySummary {
  return { facts: ["已确认"], preferences: [], decisions: [], open_loops: [], summary: text };
}

describe("memory migration (json → sqlite)", () => {
  let dir: string;
  let jsonPath: string;
  let sqlitePath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "webos-migrate-"));
    jsonPath = join(dir, "memory.json");
    sqlitePath = join(dir, "memory.db");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  describe("needsMigration", () => {
    it("is true when the legacy file exists and the database does not", () => {
      writeFileSync(jsonPath, "{}");
      expect(needsMigration(jsonPath, sqlitePath)).toBe(true);
    });

    it("is false when neither file exists", () => {
      expect(needsMigration(jsonPath, sqlitePath)).toBe(false);
    });

    it("is false once the database exists", async () => {
      const legacy = new MemoryStore({ path: jsonPath });
      await legacy.save(summary("x"), "m");
      expect(needsMigration(jsonPath, sqlitePath)).toBe(true);
      await migrateJsonToSqlite({ jsonPath, sqlitePath });
      expect(needsMigration(jsonPath, sqlitePath)).toBe(false);
    });
  });

  describe("migrateJsonToSqlite", () => {
    it("skips when the legacy file is missing", async () => {
      const result = await migrateJsonToSqlite({ jsonPath, sqlitePath });
      expect(result.skipped).toBe(true);
      expect(result.imported).toBe(0);
      expect(result.reason).toContain("未找到");
    });

    it("skips when the legacy file holds no entries", async () => {
      writeFileSync(jsonPath, JSON.stringify({ schemaVersion: 1, entries: [] }));
      const result = await migrateJsonToSqlite({ jsonPath, sqlitePath });
      expect(result.skipped).toBe(true);
      expect(result.reason).toContain("为空");
    });

    it("imports entries with their source metadata intact", async () => {
      const legacy = new MemoryStore({ path: jsonPath });
      await legacy.save(summary("第一条"), "qwen2.5:3b", { tabId: 9, turnCount: 3 });
      await legacy.save(summary("第二条"), "qwen2.5:3b");

      const result = await migrateJsonToSqlite({ jsonPath, sqlitePath });
      expect(result.skipped).toBe(false);
      expect(result.imported).toBe(2);

      const target = new SqliteMemoryStore({ path: sqlitePath });
      const entries = target.load().entries;
      target.close();

      expect(entries).toHaveLength(2);
      expect(entries.some((e) => e.memory.summary === "第一条")).toBe(true);
      expect(entries.find((e) => e.memory.summary === "第一条")?.source.tabId).toBe(9);
      expect(entries.find((e) => e.memory.summary === "第一条")?.model).toBe("qwen2.5:3b");
    });

    it("is idempotent — a second run does not duplicate", async () => {
      const legacy = new MemoryStore({ path: jsonPath });
      await legacy.save(summary("唯一一条"), "m");

      await migrateJsonToSqlite({ jsonPath, sqlitePath });
      await migrateJsonToSqlite({ jsonPath, sqlitePath });

      const target = new SqliteMemoryStore({ path: sqlitePath });
      const count = target.load().entries.length;
      target.close();
      expect(count).toBe(1);
    });

    it("never deletes the legacy file", async () => {
      const legacy = new MemoryStore({ path: jsonPath });
      await legacy.save(summary("保留原文件"), "m");
      await migrateJsonToSqlite({ jsonPath, sqlitePath });
      expect(existsSync(jsonPath)).toBe(true);
    });

    it("reports a corrupt legacy file instead of treating it as empty", async () => {
      writeFileSync(jsonPath, "{ this is not valid json");
      const result = await migrateJsonToSqlite({ jsonPath, sqlitePath });
      expect(result.skipped).toBe(true);
      // The dangerous failure is reporting "为空" here — the user would
      // believe the migration succeeded.
      expect(result.reason).toContain("损坏");
      expect(existsSync(sqlitePath)).toBe(false);
    });
  });
});
