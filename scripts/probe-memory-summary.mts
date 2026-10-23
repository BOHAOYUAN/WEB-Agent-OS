/**
 * Real-loop probe: connect to the LOCAL Actor over WebSocket and issue a
 * genuine `memory-summary` command (real Ollama, real model, real SQLite
 * read-back). Run: vite-node scripts/probe-memory-summary.mts
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { ACTOR_PROTOCOL_VERSION } from "../packages/shared/src/types/actor.js";
import { connectClient } from "../packages/actor/test/ws-client.js";

interface ActorReply {
  id: string;
  ok: boolean;
  code?: string;
  message?: string;
  model?: string;
  memory?: {
    summary: string;
    facts: string[];
    preferences: string[];
    decisions: string[];
    open_loops: string[];
  };
  snapshot?: { entries?: Array<Record<string, unknown>> };
}

const token = readFileSync(join(homedir(), "AppData", "Local", "WebOSAgent", "token.txt"), "utf8").trim();
const client = await connectClient(4321, token);
console.log("[1] WS 握手 + 令牌校验：通过");

async function rpc(id: string, body: Record<string, unknown>, timeoutMs: number): Promise<ActorReply> {
  client.send(JSON.stringify({ v: ACTOR_PROTOCOL_VERSION, id, ...body }));
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error(`等待 ${id} 超时`);
    return JSON.parse(await client.next(remaining)) as ActorReply;
  }
}

const transcript = [
  "用户：帮我记住，这个项目的回答风格要简短直接，先给结论再给理由。",
  "助手：好的，之后回答会先给结论。",
  "用户：另外我决定 P8 用声明式 DSL，不让模型产出 JavaScript。",
  "助手：已记录：PageAct 走声明式 DSL，禁止模型生成代码。",
  "用户：下周要交 PicoGrad 的答辩录屏，别忘了。",
  "助手：收到，PicoGrad 答辩录屏是待办。",
].join("\n");

const t0 = Date.now();
const reply = await rpc("probe-1", { kind: "memory-summary", transcript, timeoutMs: 60_000 }, 90_000);
const elapsed = Date.now() - t0;

if (!reply.ok) {
  console.log("[2] memory-summary 失败：", reply.code, reply.message);
  client.close();
  process.exit(1);
}
console.log(`[2] memory-summary 成功：模型=${reply.model} 耗时=${(elapsed / 1000).toFixed(1)}s`);
const memory = reply.memory!;
console.log("    summary:", memory.summary?.slice(0, 160));
console.log(`    事实(${memory.facts.length}):`, memory.facts.slice(0, 3).join(" | "));
console.log(`    偏好(${memory.preferences.length}):`, memory.preferences.slice(0, 3).join(" | "));
console.log(`    决策(${memory.decisions.length}):`, memory.decisions.slice(0, 3).join(" | "));
console.log(`    待办(${memory.open_loops.length}):`, memory.open_loops.slice(0, 3).join(" | "));

const storeReply = await rpc("probe-2", { kind: "memory-store", action: "save", memory, model: reply.model ?? "qwen2.5:3b", timeoutMs: 10_000 }, 15_000);
console.log("[3] memory-store(set)：", storeReply.ok ? "写入 SQLite 成功" : `失败 ${storeReply.code}`);

const getReply = await rpc("probe-3", { kind: "memory-store", action: "get", timeoutMs: 10_000 }, 15_000);
if (getReply.ok) {
  const entries = getReply.snapshot?.entries ?? [];
  console.log(`[4] memory-store(get)：读回 ${entries.length} 条`);
  for (const e of entries.slice(0, 5)) console.log("    -", JSON.stringify(e).slice(0, 120));
} else {
  console.log("[4] memory-store(get) 失败：", getReply.code);
}

client.close();
console.log("探针结束");
