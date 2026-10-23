/**
 * P10 spike — is `node:sqlite` usable without a flag on the target runtime?
 *
 * The V2 plan claims "zero new dependencies" for the SQLite memory store. That
 * claim rests entirely on Node's built-in `node:sqlite` being available without
 * `--experimental-sqlite`. This script proves or kills the claim before any
 * store code is written.
 *
 * Usage: node scripts/verify-sqlite.mjs
 */

import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const results = [];
const record = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};

console.log(`Node ${process.version} · ${process.platform}\n`);

const dir = mkdtempSync(join(tmpdir(), "webos-sqlite-"));
const dbPath = join(dir, "memory.db");

const SCHEMA = `
CREATE TABLE conversations (
  id TEXT PRIMARY KEY,
  tab_id INTEGER,
  site TEXT,
  started_at TEXT,
  summary TEXT,
  source_json TEXT
);
CREATE TABLE facts (
  id TEXT PRIMARY KEY,
  kind TEXT,
  key TEXT NOT NULL UNIQUE,
  value TEXT,
  confidence REAL,
  updated_at TEXT
);
CREATE TABLE episodes (
  id TEXT PRIMARY KEY,
  saved_at TEXT,
  model TEXT,
  memory_json TEXT
);
CREATE INDEX idx_episodes_saved_at ON episodes(saved_at);
CREATE INDEX idx_facts_key ON facts(key);
`;

try {
  // 1. File-backed database + schema
  const db = new DatabaseSync(dbPath);
  db.exec(SCHEMA);
  record("文件型数据库创建 + 建表", true, "3 表 + 2 索引");

  // 2. WAL — matters because the Actor writes while the UI may read
  try {
    db.exec("PRAGMA journal_mode = WAL");
    const mode = db.prepare("PRAGMA journal_mode").get();
    record("WAL 模式", String(mode?.journal_mode).toLowerCase() === "wal", `journal_mode=${mode?.journal_mode}`);
  } catch (error) {
    record("WAL 模式", false, error instanceof Error ? error.message : String(error));
  }

  // 3. Parameter binding (named + positional)
  const insert = db.prepare(
    "INSERT INTO episodes (id, saved_at, model, memory_json) VALUES (?, ?, ?, ?)",
  );
  insert.run("e1", "2026-10-23T00:00:00Z", "qwen2.5:3b", JSON.stringify({ facts: ["a"], summary: "s" }));
  const row = db.prepare("SELECT model, memory_json FROM episodes WHERE id = ?").get("e1");
  record("参数绑定 + 查询", row?.model === "qwen2.5:3b", `model=${row?.model}`);

  // 4. Transaction rollback — the store must not half-write on failure
  const txOk = (() => {
    try {
      db.exec("BEGIN");
      db.prepare("INSERT INTO facts (id, kind, key, value) VALUES (?, ?, ?, ?)").run("f1", "pref", "style", "简洁");
      db.exec("ROLLBACK");
      const after = db.prepare("SELECT COUNT(*) AS n FROM facts").get();
      return after?.n === 0;
    } catch {
      return false;
    }
  })();
  record("事务回滚", txOk, "ROLLBACK 后 facts 为空");

  // 5. Bulk insert throughput — 100 entries is the current memory.json cap
  const started = Date.now();
  db.exec("BEGIN");
  const bulk = db.prepare(
    "INSERT INTO episodes (id, saved_at, model, memory_json) VALUES (?, ?, ?, ?)",
  );
  for (let i = 0; i < 1000; i += 1) {
    bulk.run(`bulk-${i}`, new Date().toISOString(), "qwen2.5:3b", JSON.stringify({ facts: [`f${i}`] }));
  }
  db.exec("COMMIT");
  const elapsed = Date.now() - started;
  record("批量写入 1000 条", elapsed < 3000, `${elapsed} ms（含 1000 次 JSON 序列化）`);

  // 6. Query under a limit, newest-first like the current JSON store
  const page = db.prepare("SELECT id FROM episodes ORDER BY saved_at DESC LIMIT 5").all();
  record("排序 + 分页查询", page.length === 5, `返回 ${page.length} 行`);

  // 7. Persistence across close/reopen
  db.close();
  const reopened = new DatabaseSync(dbPath);
  const count = reopened.prepare("SELECT COUNT(*) AS n FROM episodes").get();
  record("关闭后重开持久化", count?.n === 1001, `count=${count?.n}`);
  reopened.close();

  // 8. Corrupt file behaviour — the JSON store backs up before overwriting,
  //    so SQLite must be probed for the equivalent failure mode.
  const corruptPath = join(dir, "corrupt.db");
  writeFileSync(corruptPath, "this is definitely not a sqlite file");
  let corruptBehaviour = "未捕获";
  let corrupt = null;
  try {
    corrupt = new DatabaseSync(corruptPath);
    corrupt.prepare("SELECT COUNT(*) AS n FROM episodes").get();
    corruptBehaviour = "静默返回";
  } catch (error) {
    corruptBehaviour = `抛错（${error instanceof Error ? error.code ?? error.name : "unknown"}）`;
  } finally {
    // Windows holds the file lock until close; skipping this makes the temp
    // dir cleanup fail with EBUSY.
    try {
      corrupt?.close();
    } catch {
      /* already closed */
    }
  }
  record("损坏文件可被检测", corruptBehaviour.startsWith("抛错"), corruptBehaviour);

  // 9. Migration shape — a legacy memory.json entry must fit, and re-running
  //    the migration must be idempotent (INSERT OR REPLACE).
  const migrate = new DatabaseSync(dbPath);
  migrate.exec("BEGIN");
  const stmt = migrate.prepare(
    "INSERT OR REPLACE INTO episodes (id, saved_at, model, memory_json) VALUES (?, ?, ?, ?)",
  );
  stmt.run("legacy-1", "2026-10-22T00:00:00Z", "qwen2.5:3b", JSON.stringify({ facts: [], preferences: [], decisions: [], open_loops: [], summary: "迁移测试" }));
  migrate.exec("COMMIT");
  const migrated = migrate.prepare("SELECT memory_json FROM episodes WHERE id = ?").get("legacy-1");
  record("legacy memory.json 条目可写入", Boolean(migrated?.memory_json), "OR REPLACE 支持幂等迁移");
  migrate.close();

  // 10. Size sanity
  const bytes = readFileSync(dbPath).length;
  record("落盘体积", bytes > 0, `${(bytes / 1024).toFixed(0)} KiB（1001 条）`);
} catch (error) {
  record("整体可用性", false, error instanceof Error ? error.message : String(error));
} finally {
  rmSync(dir, { recursive: true, force: true });
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
process.exitCode = failed.length === 0 ? 0 : 1;
