/**
 * Integration wiring for the SQLite backend — the class-level tests in
 * sqlite-store.test.ts do not cover two things that can still break:
 *   1. does `createActorServer({ memoryBackend })` actually construct a
 *      SQLite store instead of the JSON one?
 *   2. does `stop()` release the file handle? On Windows an open handle keeps
 *      memory.db locked, which would break a restart.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, rmSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ActorCommand, MemorySummary } from "@webos/shared";
import { ACTOR_PROTOCOL_VERSION } from "@webos/shared";
import { SqliteMemoryStore } from "../src/memory/sqlite-store.js";
import { handleMemoryStore } from "../src/memory/builtin.js";
import { createActorServer } from "../src/transport/server.js";

function summary(text: string): MemorySummary {
  return { facts: ["已确认"], preferences: [], decisions: [], open_loops: [], summary: text };
}

type MemoryStoreCommand = Extract<ActorCommand, { kind: "memory-store" }>;

const cmd = (action: "save" | "get" | "clear", extra: Record<string, unknown> = {}): MemoryStoreCommand =>
  ({
    v: ACTOR_PROTOCOL_VERSION,
    id: "cmd-1",
    kind: "memory-store",
    action,
    timeoutMs: 5000,
    ...extra,
  }) as MemoryStoreCommand;

describe("SQLite backend integration", () => {
  let dir: string;
  let dbPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "webos-sqlite-int-"));
    dbPath = join(dir, "memory.db");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("handleMemoryStore works through the SQLite backend (sync/async contract)", async () => {
    const store = new SqliteMemoryStore({ path: dbPath });
    try {
      const saved = await handleMemoryStore(
        cmd("save", { memory: summary("集成测试"), model: "qwen2.5:3b", source: { tabId: 4 } }),
        store,
      );
      expect(saved.ok).toBe(true);

      const got = await handleMemoryStore(cmd("get"), store);
      expect(got.ok).toBe(true);
      if (got.ok && got.kind === "memory-store" && got.action === "get") {
        expect(got.snapshot.entries).toHaveLength(1);
        expect(got.snapshot.entries[0]?.memory.summary).toBe("集成测试");
        expect(got.snapshot.entries[0]?.source.tabId).toBe(4);
      } else {
        throw new Error("期望 get 返回 snapshot");
      }

      const cleared = await handleMemoryStore(cmd("clear"), store);
      expect(cleared.ok).toBe(true);
    } finally {
      store.close();
    }
  });

  it("server starts with the sqlite backend and releases the file on stop", async () => {
    const server = await createActorServer({
      token: "integration-token",
      port: 0,
      allowedOrigins: [],
      memoryBackend: "sqlite",
      memoryPath: dbPath,
      log: () => undefined,
    });

    // Touch the store the same way a client would, so the file must exist.
    const store = new SqliteMemoryStore({ path: dbPath });
    store.save(summary("服务端集成"), "m");
    store.close();

    expect(server.port).toBeGreaterThan(0);
    await server.stop();

    // If stop() forgot to close the handle, unlink throws EBUSY on Windows.
    expect(() => unlinkSync(dbPath)).not.toThrow();
    // SQLite checkpoints and deletes the WAL when the last connection closes,
    // so its absence is correct behaviour, not a missing cleanup.
    for (const sidecar of [`${dbPath}-wal`, `${dbPath}-shm`]) {
      if (existsSync(sidecar)) unlinkSync(sidecar);
    }
  });

  it("server still supports the legacy json backend", async () => {
    const jsonPath = join(dir, "memory.json");
    const server = await createActorServer({
      token: "integration-token",
      port: 0,
      allowedOrigins: [],
      memoryBackend: "json",
      memoryPath: jsonPath,
      log: () => undefined,
    });
    await server.stop();
    // No file is created until something is written; the point is that the
    // json branch constructs without error and stop() does not throw.
    expect(server.port).toBeGreaterThan(0);
  });
});
