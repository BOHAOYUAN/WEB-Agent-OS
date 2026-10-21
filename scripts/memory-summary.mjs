#!/usr/bin/env node
/**
 * Standalone long-term memory summarizer (prototype).
 *
 * Calls a LOCAL Ollama model on 127.0.0.1 only. No cloud API, no DeepSeek quota.
 * It is intentionally not wired into the extension yet: this is the smallest
 * runnable step for evaluating model quality and latency on your machine.
 *
 * Usage:
 *   node scripts/memory-summary.mjs --file transcript.json
 *   node scripts/memory-summary.mjs --file transcript.json --model qwen2.5:3b
 *   node scripts/memory-summary.mjs --file transcript.json --dry-run
 *
 * Input: .json (array of {role, content} or {messages:[...]}), .jsonl, or .txt.
 * Output: <input>.memory.json with validated JSON memory + timing.
 */
import { readFile, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";

const DEFAULT_MODEL = "qwen2.5:3b";
const DEFAULT_ENDPOINT = process.env.OLLAMA_URL ?? "http://127.0.0.1:11434";
const DEFAULT_MAX_INPUT_CHARS = 4000;
const DEFAULT_TIMEOUT_MS = 180_000;

const SYSTEM_PROMPT = [
  "你是一个长期记忆压缩器，服务于一个 AI Agent。",
  "你的任务是把对话压缩成严格 JSON，只保留对后续对话真正有用的信息。",
  "不要编造。不确定的内容放进 open_loops，不要放进 facts。",
  "忽略寒暄、重复、助手的长篇解释和思考过程。",
  "只输出 JSON，不要 Markdown，不要解释。",
].join("\n");

const OUTPUT_SHAPE = {
  facts: [],
  preferences: [],
  decisions: [],
  open_loops: [],
  summary: "",
};

function usage() {
  return [
    "用法：node scripts/memory-summary.mjs --file <transcript.json|jsonl|txt> [options]",
    "",
    "选项：",
    "  --model <name>           Ollama 模型，默认 " + DEFAULT_MODEL,
    "  --endpoint <url>         Ollama 地址，默认 " + DEFAULT_ENDPOINT,
    "  --out <path>             输出文件，默认 <input>.memory.json",
    "  --max-input-chars <n>    只保留最近 n 个字符，默认 " + DEFAULT_MAX_INPUT_CHARS,
    "  --timeout-ms <n>         请求超时，默认 " + DEFAULT_TIMEOUT_MS,
    "  --dry-run                只打印 prompt 和 schema，不调用模型",
    "  --help                   显示本帮助",
  ].join("\n");
}

function parseArgs(argv) {
  const opts = {
    file: null,
    model: DEFAULT_MODEL,
    endpoint: DEFAULT_ENDPOINT,
    out: null,
    maxInputChars: DEFAULT_MAX_INPUT_CHARS,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    dryRun: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      const value = argv[i + 1];
      if (value === undefined) throw new Error(arg + " 需要一个值");
      i += 1;
      return value;
    };
    const [key, inline] = arg.includes("=") ? [arg.slice(0, arg.indexOf("=")), arg.slice(arg.indexOf("=") + 1)] : [arg, undefined];
    const value = inline ?? (() => {
      if (["--help", "--dry-run"].includes(key)) return undefined;
      if (["--file", "--model", "--endpoint", "--out", "--max-input-chars", "--timeout-ms"].includes(key)) return next();
      return undefined;
    })();

    switch (key) {
      case "--file":
        opts.file = value;
        break;
      case "--model":
        opts.model = value;
        break;
      case "--endpoint":
        opts.endpoint = value;
        break;
      case "--out":
        opts.out = value;
        break;
      case "--max-input-chars":
        opts.maxInputChars = Number(value);
        break;
      case "--timeout-ms":
        opts.timeoutMs = Number(value);
        break;
      case "--dry-run":
        opts.dryRun = true;
        break;
      case "--help":
        console.log(usage());
        process.exit(0);
        break;
      default:
        throw new Error("未知参数：" + arg + "\n\n" + usage());
    }
  }

  if (!opts.file) throw new Error("缺少 --file\n\n" + usage());
  if (!Number.isInteger(opts.maxInputChars) || opts.maxInputChars < 200) throw new Error("--max-input-chars 必须是 >=200 的整数");
  if (!Number.isInteger(opts.timeoutMs) || opts.timeoutMs < 1000) throw new Error("--timeout-ms 必须是 >=1000 的整数");
  return opts;
}

function flattenItems(items) {
  const lines = [];
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    if (item.role !== "user" && item.role !== "assistant") continue;
    if (typeof item.content !== "string" || item.content.trim() === "") continue;
    lines.push((item.role === "user" ? "用户" : "助手") + "：" + item.content.trim());
  }
  return lines.join("\n\n");
}

async function loadTranscript(file) {
  const raw = await readFile(file, "utf8");
  const ext = extname(file).toLowerCase();

  if (ext === ".json") {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return flattenItems(parsed);
    if (parsed && Array.isArray(parsed.messages)) return flattenItems(parsed.messages);
    throw new Error("JSON 输入必须是 [{role,content}] 或 {messages:[...]}");
  }

  if (ext === ".jsonl") {
    const items = raw.split(/\r?\n/).filter((line) => line.trim() !== "").map((line) => JSON.parse(line));
    return flattenItems(items);
  }

  return raw.trim();
}

function clipTranscript(transcript, maxChars) {
  if (transcript.length <= maxChars) return { transcript, truncated: false, droppedChars: 0 };
  return {
    transcript: transcript.slice(-maxChars),
    truncated: true,
    droppedChars: transcript.length - maxChars,
  };
}

function buildPrompt(transcript) {
  return [
    "请把下面这段对话压缩成长期记忆，严格输出以下 JSON 结构：",
    JSON.stringify(OUTPUT_SHAPE, null, 2),
    "",
    "字段规则：",
    "- facts：最多 5 条，已确认的事实/项目状态；每条不超过 40 个汉字。",
    "- preferences：最多 3 条，用户的稳定偏好或约束；每条不超过 40 个汉字。",
    "- decisions：最多 3 条，已经拍板的决策；每条不超过 40 个汉字。",
    "- open_loops：最多 3 条，未完成/待验证/有风险的事项；每条不超过 40 个汉字。",
    "- summary：不超过 120 个汉字，概括这段对话对后续最有用的内容。",
    "所有数组只能包含字符串。没有内容就给空数组。只输出 JSON。",
    "",
    "对话：",
    transcript,
  ].join("\n");
}

function parseModelJson(content) {
  const cleaned = content
    .trim()
    .replace(/^\u0060\u0060\u0060(?:json)?\s*/i, "")
    .replace(/\s*\u0060\u0060\u0060$/i, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) throw new Error("模型没有返回 JSON");
  const parsed = JSON.parse(cleaned.slice(start, end + 1));
  return normalizeSummary(parsed);
}

function asStringArray(value, limit) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, limit)
    .map((item) => item.slice(0, 80));
}

function normalizeSummary(parsed) {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("模型输出不是 JSON 对象");
  return {
    facts: asStringArray(parsed.facts, 5),
    preferences: asStringArray(parsed.preferences, 3),
    decisions: asStringArray(parsed.decisions, 3),
    open_loops: asStringArray(parsed.open_loops, 3),
    summary: typeof parsed.summary === "string" ? parsed.summary.trim().slice(0, 200) : "",
  };
}

async function callOllama({ endpoint, model, transcript, timeoutMs }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const url = endpoint.replace(/\/$/, "") + "/api/chat";

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model,
        stream: false,
        format: "json",
        keep_alive: "5m",
        options: {
          temperature: 0.2,
          top_p: 0.9,
          num_ctx: 8192,
          num_predict: 500,
        },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: buildPrompt(transcript) },
        ],
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const body = await response.text();
      if (response.status === 404) {
        throw new Error("模型未安装：" + model + "\n  ollama pull " + model);
      }
      throw new Error("Ollama HTTP " + response.status + "：" + body.slice(0, 500));
    }

    return await response.json();
  } catch (error) {
    if (error && error.name === "AbortError") {
      throw new Error("Ollama 请求超时（" + timeoutMs + "ms）");
    }
    if (error instanceof TypeError) {
      throw new Error(
        "无法连接 Ollama（" + endpoint + "）。先安装并启动：\n" +
          "  winget install Ollama.Ollama\n" +
          "  ollama pull " + model + "\n" +
          "  ollama serve",
      );
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function formatSeconds(seconds) {
  return Number.isFinite(seconds) ? seconds.toFixed(2) + "s" : "n/a";
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const transcript = await loadTranscript(opts.file);
  const clipped = clipTranscript(transcript, opts.maxInputChars);
  const prompt = buildPrompt(clipped.transcript);

  if (opts.dryRun) {
    console.log("== model ==");
    console.log(opts.model);
    console.log("== input ==");
    console.log("chars=" + transcript.length + " kept=" + clipped.transcript.length + " truncated=" + clipped.truncated);
    console.log("== prompt ==");
    console.log(prompt);
    return;
  }

  console.log("[memory] model=" + opts.model + " input_chars=" + clipped.transcript.length + (clipped.truncated ? " (truncated " + clipped.droppedChars + " chars)" : ""));
  const startedAt = Date.now();
  const response = await callOllama({
    endpoint: opts.endpoint,
    model: opts.model,
    transcript: clipped.transcript,
    timeoutMs: opts.timeoutMs,
  });
  const wallSeconds = (Date.now() - startedAt) / 1000;

  const content = response && response.message && typeof response.message.content === "string" ? response.message.content : "";
  if (!content) throw new Error("Ollama 返回为空：" + JSON.stringify(response).slice(0, 500));

  const memory = parseModelJson(content);
  const evalCount = typeof response.eval_count === "number" ? response.eval_count : null;
  const evalDurationNs = typeof response.eval_duration === "number" ? response.eval_duration : null;
  const totalDurationNs = typeof response.total_duration === "number" ? response.total_duration : null;
  const tokensPerSecond = evalCount !== null && evalDurationNs ? evalCount / (evalDurationNs / 1e9) : null;

  const outPath = opts.out ?? join(dirname(opts.file), basename(opts.file, extname(opts.file)) + ".memory.json");
  const payload = {
    model: opts.model,
    generatedAt: new Date().toISOString(),
    source: opts.file,
    truncated: clipped.truncated,
    droppedChars: clipped.droppedChars,
    timing: {
      wallSeconds: Number(wallSeconds.toFixed(2)),
      totalSeconds: totalDurationNs ? Number((totalDurationNs / 1e9).toFixed(2)) : null,
      tokensPerSecond: tokensPerSecond ? Number(tokensPerSecond.toFixed(1)) : null,
      evalTokens: evalCount,
    },
    memory,
  };
  await writeFile(outPath, JSON.stringify(payload, null, 2) + "\n", "utf8");

  console.log("[memory] done in " + formatSeconds(wallSeconds) + (tokensPerSecond ? " · " + tokensPerSecond.toFixed(1) + " tok/s" : ""));
  console.log("[memory] summary chars=" + memory.summary.length + " facts=" + memory.facts.length + " prefs=" + memory.preferences.length + " decisions=" + memory.decisions.length + " open_loops=" + memory.open_loops.length);
  console.log("[memory] saved " + outPath);
  console.log(JSON.stringify(memory, null, 2));
}

main().catch((error) => {
  console.error("[memory] " + (error instanceof Error ? error.message : String(error)));
  process.exitCode = 1;
});
