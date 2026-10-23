import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { MemoryStoreSnapshot, MemorySummary } from "@webos/shared";
import { SqliteMemoryStore } from "../src/memory/sqlite-store.js";

/** See the note in sqlite-store.ts — Vite 5 cannot resolve `node:sqlite`. */
const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");

function summary(text: string): MemorySummary {
  return { facts: ["已确认的事实"], preferences: [], decisions: [], open_loops: [], summary: text };
}

describe("SqliteMemoryStore", () => {
  let dir: string;
  let store: SqliteMemoryStore;
  let dbPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "webos-sqlite-test-"));
    dbPath = join(dir, "memory.db");
    store = new SqliteMemoryStore({ path: dbPath });
  });

  afterEach(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("defaults to a path under the user's home", () => {
    const home = new SqliteMemoryStore();
    expect(home.filePath).toContain(".webos-agent");
    expect(home.filePath.endsWith("memory.db")).toBe(true);
  });

  it("returns an empty snapshot before anything is saved", () => {
    expect(store.load()).toEqual({ schemaVersion: 1, entries: [] });
  });

  it("round-trips a saved entry", () => {
    const saved = store.save(summary("第一轮"), "qwen2.5:3b", { tabId: 7, turnCount: 2 });
    const snapshot = store.load();
    expect(snapshot.entries).toHaveLength(1);
    expect(snapshot.entries[0]?.id).toBe(saved.id);
    expect(snapshot.entries[0]?.model).toBe("qwen2.5:3b");
    expect(snapshot.entries[0]?.memory.summary).toBe("第一轮");
    expect(snapshot.entries[0]?.source.tabId).toBe(7);
  });

  it("returns newest first", () => {
    store.save(summary("旧"), "m");
    store.save(summary("新"), "m");
    const entries = store.load().entries;
    expect(entries).toHaveLength(2);
    expect(entries.map((e) => e.memory.summary)).toEqual(["新", "旧"]);
  });

  it("caps entries at 100", () => {
    for (let i = 0; i < 130; i += 1) store.save(summary(`第 ${i} 条`), "m");
    const entries = store.load().entries;
    expect(entries).toHaveLength(100);
  });

  it("persists across a reopened connection", () => {
    store.save(summary("跨连接"), "m");
    store.close();
    const reopened = new SqliteMemoryStore({ path: dbPath });
    expect(reopened.load().entries).toHaveLength(1);
    reopened.close();
  });

  it("skips entries whose stored memory is corrupt instead of throwing", () => {
    store.save(summary("正常"), "m");
    store.close();
    const raw = new DatabaseSync(dbPath);
    raw.exec("UPDATE episodes SET memory_json = 'not json' WHERE 1=1");
    raw.close();
    const reopened = new SqliteMemoryStore({ path: dbPath });
    expect(reopened.load().entries).toEqual([]);
    reopened.close();
  });

  it("clear removes the database and its WAL sidecars", async () => {
    store.save(summary("待清除"), "m");
    store.close();
    await store.clear();
    expect(existsSync(dbPath)).toBe(false);
  });

  it("quarantine renames the file instead of deleting it", async () => {
    writeFileSync(dbPath, "definitely not sqlite");
    const backup = await store.quarantine("corrupt");
    expect(backup).toBeTruthy();
    expect(existsSync(dbPath)).toBe(false);
    expect(existsSync(backup as string)).toBe(true);
  });

  it("quarantine returns null when there is no database", async () => {
    await expect(store.quarantine("missing")).resolves.toBeNull();
  });

  it("close is idempotent", () => {
    store.save(summary("x"), "m");
    expect(() => {
      store.close();
      store.close();
    }).not.toThrow();
  });

  describe("migrateFromSnapshot", () => {
    it("imports legacy entries and is idempotent", () => {
      const snapshot: MemoryStoreSnapshot = {
        schemaVersion: 1,
        entries: [
          {
            id: "legacy-1",
            savedAt: "2026-10-22T00:00:00.000Z",
            model: "qwen2.5:3b",
            source: { tabId: 1 },
            memory: summary("旧记忆"),
          },
        ],
      };
      expect(store.migrateFromSnapshot(snapshot)).toBe(1);
      expect(store.migrateFromSnapshot(snapshot)).toBe(1);
      expect(store.load().entries).toHaveLength(1);
      expect(store.load().entries[0]?.id).toBe("legacy-1");
    });
  });

  describe("facts", () => {
    it("upserts by key rather than duplicating", () => {
      store.upsertFact("preference", "reply-style", "简洁");
      store.upsertFact("preference", "reply-style", "更简洁");
      const facts = store.queryFacts();
      expect(facts).toHaveLength(1);
      expect(facts[0]?.value).toBe("更简洁");
    });

    it("filters by kind", () => {
      store.upsertFact("preference", "a", "1");
      store.upsertFact("convention", "b", "2");
      expect(store.queryFacts("preference")).toHaveLength(1);
      expect(store.queryFacts("convention")[0]?.key).toBe("b");
    });

    it("survives a reopen", () => {
      store.upsertFact("preference", "style", "带行号");
      store.close();
      const reopened = new SqliteMemoryStore({ path: dbPath });
      expect(reopened.queryFacts("preference")[0]?.value).toBe("带行号");
      reopened.close();
    });
  });
});
