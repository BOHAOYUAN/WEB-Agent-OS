#!/usr/bin/env node
/**
 * Actor bridge CLI — the independent Node entry point for the local Actor
 * WebSocket server.
 *
 * This file is intentionally NOT exported from the package index: importing it
 * must never start a server. Run the built bundle via `npm run actor:start`
 * (builds `dist/actor-cli.js` first).
 */

import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { mkdir } from "node:fs/promises";
import { createActorServer } from "./transport/server.js";
import { generateToken } from "./security/token.js";
import { DEFAULT_MEMORY_PATH } from "./memory/store.js";
import { DEFAULT_SQLITE_PATH } from "./memory/sqlite-store.js";
import type { MemoryBackend } from "./memory/types.js";
import { migrateJsonToSqlite, needsMigration } from "./memory/migrate.js";

const DEFAULT_PORT = 4319;
const DEFAULT_MODEL = "qwen2.5:3b";
const DEFAULT_ENDPOINT = "http://127.0.0.1:11434";

interface CliOptions {
  port: number;
  token: string;
  endpoint: string;
  model: string;
  cwd: string;
  /** undefined = let the backend decide its own default path */
  memoryPath?: string;
  memoryBackend: MemoryBackend;
  migrateMemory: boolean;
  allowOrigins: string[];
  help: boolean;
}

function usage(): string {
  return [
    "用法：actor-cli [options]",
    "",
    "选项：",
    "  --port <n>                 监听端口，默认 " + DEFAULT_PORT,
    "  --token <str>              握手 token，缺省自动生成",
    "  --ollama-endpoint <url>    Ollama 地址，默认 " + DEFAULT_ENDPOINT,
    "  --ollama-model <name>      Ollama 模型，默认 " + DEFAULT_MODEL,
    "  --cwd <path>               exec 工作目录，默认 ~/.webos-agent/workspace",
    "  --memory-backend <name>    记忆后端：sqlite（默认）或 json",
    "  --memory-path <path>       记忆文件路径，默认随后端：memory.db / memory.json",
    "  --migrate-memory           把旧 memory.json 导入 SQLite 后退出（原文件保留）",
    "  --allow-origin <origin>    允许的 Origin，可重复（如 chrome-extension://<id>）",
    "  --help                     显示本帮助",
  ].join("\n");
}

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = {
    port: DEFAULT_PORT,
    token: generateToken(),
    endpoint: DEFAULT_ENDPOINT,
    model: DEFAULT_MODEL,
    cwd: join(homedir(), ".webos-agent", "workspace"),
    memoryBackend: "sqlite",
    migrateMemory: false,
    allowOrigins: [],
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    const next = () => {
      const value = argv[i + 1];
      if (value === undefined) throw new Error(arg + " 需要一个值");
      i += 1;
      return value;
    };
    const eq = arg.indexOf("=");
    const key = eq === -1 ? arg : arg.slice(0, eq);
    const inline = eq === -1 ? undefined : arg.slice(eq + 1);
    const needsValue = ["--port", "--token", "--ollama-endpoint", "--ollama-model", "--cwd", "--memory-path", "--memory-backend", "--allow-origin"].includes(key);
    const value = inline ?? (key === "--help" ? undefined : needsValue ? next() : undefined);

    switch (key) {
      case "--port":
        opts.port = Number(value);
        break;
      case "--token":
        opts.token = value as string;
        break;
      case "--ollama-endpoint":
        opts.endpoint = value as string;
        break;
      case "--ollama-model":
        opts.model = value as string;
        break;
      case "--cwd":
        opts.cwd = value as string;
        break;
      case "--memory-path":
        opts.memoryPath = value as string;
        break;
      case "--memory-backend": {
        const backend = value as string;
        if (backend !== "sqlite" && backend !== "json") {
          throw new Error("--memory-backend 只能是 sqlite 或 json");
        }
        opts.memoryBackend = backend;
        break;
      }
      case "--migrate-memory":
        opts.migrateMemory = true;
        break;
      case "--allow-origin":
        opts.allowOrigins.push(value as string);
        break;
      case "--help":
        opts.help = true;
        break;
      default:
        throw new Error("未知参数：" + arg + "\n\n" + usage());
    }
  }

  if (!Number.isInteger(opts.port) || opts.port < 1 || opts.port > 65535) throw new Error("--port 必须是 1-65535 的整数");
  return opts;
}

function assertLocalEndpoint(endpoint: string): void {
  const host = new URL(endpoint).hostname;
  const local = host === "127.0.0.1" || host === "localhost" || host === "[::1]" || host === "::1";
  if (!local) throw new Error("--ollama-endpoint 必须是 localhost/127.0.0.1（防 SSRF）");
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log(usage());
    return;
  }

  assertLocalEndpoint(opts.endpoint);

  const cwd = resolve(opts.cwd);
  await mkdir(cwd, { recursive: true });

  const memoryPath = opts.memoryPath ?? (opts.memoryBackend === "json" ? DEFAULT_MEMORY_PATH : DEFAULT_SQLITE_PATH);

  // Standalone migration: import the legacy file, then exit.
  if (opts.migrateMemory) {
    const result = await migrateJsonToSqlite({ jsonPath: DEFAULT_MEMORY_PATH, sqlitePath: memoryPath });
    console.log(
      result.skipped
        ? `[actor] 跳过迁移：${result.reason ?? "无内容"}`
        : `[actor] 已迁移 ${result.imported} 条记忆 → ${result.sqlitePath}（原 memory.json 保留）`,
    );
    return;
  }

  // First run on SQLite: import the legacy store if one exists. The source file
  // is never deleted here — that decision stays with the user.
  // Only auto-import into the DEFAULT database. An explicit --memory-path asks
  // for exactly that file; importing unrelated legacy data into it would make
  // the CLI (and its tests) non-hermetic.
  if (opts.memoryBackend === "sqlite" && !opts.memoryPath && needsMigration(DEFAULT_MEMORY_PATH, memoryPath)) {
    const result = await migrateJsonToSqlite({ jsonPath: DEFAULT_MEMORY_PATH, sqlitePath: memoryPath });
    if (!result.skipped) {
      console.log(
        `[actor] 首次启动：已从 memory.json 迁移 ${result.imported} 条记忆（原文件保留，确认无误后可自行删除）`,
      );
    }
  }

  const server = await createActorServer({
    host: "127.0.0.1",
    port: opts.port,
    token: opts.token,
    allowedOrigins: opts.allowOrigins,
    exec: { cwd },
    ollama: { endpoint: opts.endpoint, model: opts.model },
    memoryBackend: opts.memoryBackend,
    memoryPath,
  });

  // Startup banner is the ONLY place the token is printed, so the user can copy
  // it into the sidepanel. Runtime logs never echo the token or a tokenized URL.
  console.log("[actor] token: " + opts.token);
  console.log("[actor] port: " + server.port);
  console.log("[actor] allow-origin: " + (opts.allowOrigins.length ? opts.allowOrigins.join(",") : "(none)"));
  console.log("[actor] ollama: " + opts.endpoint + " model=" + opts.model);
  console.log("[actor] cwd: " + cwd);
  console.log(`[actor] memory: ${memoryPath} (${opts.memoryBackend})`);
  console.log("[actor] listening on 127.0.0.1:" + server.port);

  const shutdown = async (): Promise<void> => {
    console.log("[actor] shutting down");
    await server.stop();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}

main().catch((error) => {
  console.error("[actor] " + (error instanceof Error ? error.message : String(error)));
  process.exitCode = 1;
});
