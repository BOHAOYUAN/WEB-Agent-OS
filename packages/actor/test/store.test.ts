import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryStore } from "../src/memory/store.js";

const MEMORY = {
  facts: ["事实一"],
  preferences: ["偏好一"],
  decisions: [],
  open_loops: [],
  summary: "总结",
};

let dirs: string[] = [];

async function tempPath(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "webos-store-"));
  dirs.push(dir);
  return join(dir, "memory.json");
}

afterEach(async () => {
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
  dirs = [];
});

describe("MemoryStore", () => {
  it("load returns an empty snapshot for a missing file", async () => {
    const store = new MemoryStore({ path: await tempPath() });
    expect(await store.load()).toEqual({ schemaVersion: 1, entries: [] });
  });

  it("save then load round-trips a newest-first entry", async () => {
    const store = new MemoryStore({ path: await tempPath() });
    const entry = await store.save(MEMORY, "qwen2.5:3b", { tabId: 1 });
    const snapshot = await store.load();
    expect(snapshot.entries).toHaveLength(1);
    expect(snapshot.entries[0]?.memory).toEqual(MEMORY);
    expect(snapshot.entries[0]?.model).toBe("qwen2.5:3b");
    expect(snapshot.entries[0]?.id).toBe(entry.id);
  });

  it("persists the full provenance source (tabId / pageSessionId / turnCount)", async () => {
    const store = new MemoryStore({ path: await tempPath() });
    const source = { tabId: 42, pageSessionId: "session-abc", turnCount: 3 };
    const entry = await store.save(MEMORY, "qwen2.5:3b", source);
    expect(entry.source).toEqual(source);
    const snapshot = await store.load();
    expect(snapshot.entries[0]?.source).toEqual(source);
  });

  it("clear deletes the file", async () => {
    const store = new MemoryStore({ path: await tempPath() });
    await store.save(MEMORY, "m");
    await store.clear();
    expect(await store.load()).toEqual({ schemaVersion: 1, entries: [] });
  });

  it("returns empty without overwriting a corrupt file", async () => {
    const path = await tempPath();
    await writeFile(path, "{ not json", "utf8");
    const store = new MemoryStore({ path });
    expect(await store.load()).toEqual({ schemaVersion: 1, entries: [] });
    expect(await readFile(path, "utf8")).toBe("{ not json");
  });

  it("recovers from a corrupt file on save (backup + overwrite)", async () => {
    const path = await tempPath();
    await writeFile(path, "{ not json", "utf8");
    const store = new MemoryStore({ path });
    await store.save(MEMORY, "m");
    const snapshot = await store.load();
    expect(snapshot.entries).toHaveLength(1);
    expect(snapshot.entries[0]?.memory).toEqual(MEMORY);
  });

  it("caps entries at 100", async () => {
    const store = new MemoryStore({ path: await tempPath() });
    for (let index = 0; index < 105; index += 1) await store.save(MEMORY, "m");
    const snapshot = await store.load();
    expect(snapshot.entries.length).toBeLessThanOrEqual(100);
  });

  it("stores entries newest-first", async () => {
    const store = new MemoryStore({ path: await tempPath() });
    await store.save({ ...MEMORY, summary: "第一条" }, "m");
    await store.save({ ...MEMORY, summary: "第二条" }, "m");
    const snapshot = await store.load();
    expect(snapshot.entries[0]?.memory.summary).toBe("第二条");
    expect(snapshot.entries[1]?.memory.summary).toBe("第一条");
  });

  it("defaults to a path under the home directory", () => {
    const store = new MemoryStore();
    expect(store.filePath).toContain(".webos-agent");
  });
});
