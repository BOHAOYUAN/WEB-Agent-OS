/**
 * Local transcript summarization (situational memory primitive).
 *
 * Wraps a LOCAL Ollama model (default qwen2.5:3b) over plain HTTP on
 * 127.0.0.1 only. It compresses a conversation transcript into a small
 * structured JSON (facts / preferences / decisions / open_loops / summary)
 * that later turns can inject as situational memory.
 *
 * Red lines:
 *  - endpoint is forced to localhost / 127.0.0.1 (SSRF guard);
 *  - `format: "json"` is requested and the response is strictly parsed — any
 *    non-JSON output becomes an `invalid-json` error and is never persisted;
 *  - offline / timeout surface as distinct error codes, never hang.
 */

import type { MemorySummary } from "@webos/shared";

export const DEFAULT_MODEL = "qwen2.5:3b";
export const DEFAULT_ENDPOINT = "http://127.0.0.1:11434";
export const DEFAULT_TIMEOUT_MS = 60_000;
/** Second defense-in-depth cap on the transcript embedded in the prompt. */
export const MAX_PROMPT_CHARS = 16 * 1024;

/**
 * Exported so the V2 model A/B gate (`scripts/brain-ab/`) can run candidates
 * through the EXACT production prompt instead of a copy that would drift.
 */
export const SYSTEM_PROMPT = [
  "你是一个长期记忆压缩器，服务于一个 AI Agent。",
  "你的任务是把对话压缩成严格 JSON，只保留对后续对话真正有用的信息。",
  "不要编造。不确定的内容放进 open_loops，不要放进 facts。",
  "最重要的规则：facts 只放『已经发生、且对话明确确认』的事。",
  "计划、下一步、待办、打算做的事、未验证的结论，一律放进 open_loops，绝不放进 facts。",
  "忽略寒暄、重复、助手的长篇解释和思考过程。",
  "只输出 JSON，不要 Markdown，不要解释。",
].join("\n");

const OUTPUT_SHAPE: MemorySummary = {
  facts: [],
  preferences: [],
  decisions: [],
  open_loops: [],
  summary: "",
};

export type SummarizeErrorCode = "ollama-unavailable" | "ollama-timeout" | "invalid-json";

export type SummarizeResult =
  | {
      ok: true;
      memory: MemorySummary;
      model: string;
      elapsedMs: number;
      evalTokens: number | null;
      tokensPerSecond: number | null;
    }
  | { ok: false; code: SummarizeErrorCode; message: string };

export interface SummarizeOptions {
  endpoint?: string;
  model?: string;
  timeoutMs?: number;
  /** Injectable fetch for tests (defaults to globalThis.fetch). */
  fetchImpl?: typeof fetch;
}

function assertLocalEndpoint(endpoint: string): void {
  let host: string;
  try {
    host = new URL(endpoint).hostname;
  } catch {
    throw new Error("invalid endpoint URL");
  }
  const local = host === "127.0.0.1" || host === "localhost" || host === "[::1]" || host === "::1";
  if (!local) throw new Error("endpoint must be localhost or 127.0.0.1 (SSRF guard)");
}

/** Build the user prompt that asks the model for a strict JSON memory. */
export function buildPrompt(transcript: string): string {
  const clipped = transcript.length > MAX_PROMPT_CHARS ? transcript.slice(-MAX_PROMPT_CHARS) : transcript;
  return [
    "请把下面这段对话压缩成长期记忆，严格输出以下 JSON 结构：",
    JSON.stringify(OUTPUT_SHAPE, null, 2),
    "",
    "字段规则：",
    "- facts：最多 5 条，只放已经发生且对话明确确认的事实；每条不超过 40 个汉字。",
    "- preferences：最多 3 条，用户的稳定偏好或约束；每条不超过 40 个汉字。",
    "- decisions：最多 3 条，只放已经拍板的技术方案或路线选择（例如「用 A 不用 B」）；截止日期、要交的东西、要做的动作都不是决策；每条不超过 40 个汉字。",
    "- open_loops：最多 3 条，未完成/计划中/待验证/有风险的事项；每条不超过 40 个汉字。",
    "- summary：不超过 120 个汉字，概括这段对话对后续最有用的内容。",
    "所有数组只能包含字符串。没有内容就给空数组。只输出 JSON。",
    "",
    "判定示例（务必遵守）：",
    '- 对话里说「下一步做 Stage 2」→ 这是计划，必须放 open_loops，绝不能放 facts。',
    '- 对话里说「Stage 1 已完成并通过验证」→ 这是已确认事实，放 facts。',
    '- 对话里说「等有空再验证这个 bug」→ 待办，放 open_loops。',
    '- 对话里说「下周要交答辩录屏，别忘了」→ 带截止日期的待办，放 open_loops，绝不能放 decisions。',
    '- 对话里说「我更喜欢简洁的回复」→ 稳定偏好，放 preferences。',
    "",
    "对话：",
    clipped,
  ].join("\n");
}

/**
 * Length contract, mirroring the prompt. Exported so the A/B gate measures
 * against the same numbers instead of hard-coding its own.
 *
 * Measured at 2026-10-23: a 1.5B model overflows the 40-char limit on 43% of
 * facts (3B: 4%), so the limit is enforced here rather than trusted from the
 * prompt.
 */
export const MAX_FACT_CHARS = 40;
export const MAX_SUMMARY_CHARS = 120;
/** Anti-explosion ceiling applied before the length contract is checked. */
const HARD_CAP_CHARS = 240;

/**
 * Coerce to a trimmed string array, then DROP entries that overflow the
 * length contract. Truncating would be worse than dropping: a fact sliced
 * mid-sentence is a fragment that reads as evidence to the next turn.
 */
function asStringArray(value: unknown, limit: number, maxChars: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, limit)
    .map((item) => item.slice(0, HARD_CAP_CHARS))
    .filter((item) => item.length <= maxChars);
}

/**
 * Future-tense markers that must never appear in `facts`. Small models (3B)
 * habitually write plans ("下一步做 X") as accomplished facts; injecting that
 * into a later turn would poison the context with false facts.
 *
 * Relocation (not deletion) is the safe direction: an already-done item that
 * lands in open_loops is harmless, a plan that lands in facts is not.
 */
export const FUTURE_MARKER = /(下一步|接下来|待办|待验证|尚未|还没|打算|计划|将会|将要做|要做|需要做|准备)/;

/** Deterministic facts/open_loops boundary guard. Runs after model output. */
export function enforceFactsBoundary(memory: MemorySummary): MemorySummary {
  const facts: string[] = [];
  const displaced: string[] = [];
  for (const fact of memory.facts) {
    if (FUTURE_MARKER.test(fact)) {
      displaced.push(fact);
    } else {
      facts.push(fact);
    }
  }
  if (displaced.length === 0) return memory;
  const seen = new Set(memory.open_loops);
  const openLoops = [...memory.open_loops];
  for (const item of displaced) {
    if (!seen.has(item)) {
      seen.add(item);
      openLoops.push(item);
    }
  }
  return { ...memory, facts, open_loops: openLoops.slice(0, 5) };
}

/** Coerce an arbitrary parsed value into a validated MemorySummary. */
export function normalizeSummary(parsed: unknown): MemorySummary {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("模型输出不是 JSON 对象");
  }
  const record = parsed as Record<string, unknown>;
  return enforceFactsBoundary({
    facts: asStringArray(record.facts, 5, MAX_FACT_CHARS),
    preferences: asStringArray(record.preferences, 3, MAX_FACT_CHARS),
    decisions: asStringArray(record.decisions, 3, MAX_FACT_CHARS),
    open_loops: asStringArray(record.open_loops, 3, MAX_FACT_CHARS),
    summary: typeof record.summary === "string" ? record.summary.trim().slice(0, MAX_SUMMARY_CHARS) : "",
  });
}

/** Parse the model's raw text output (may be fenced) into a MemorySummary. */
export function parseModelJson(content: string): MemorySummary {
  const cleaned = content
    .trim()
    .replace(/^\u0060\u0060\u0060(?:json)?\s*/i, "")
    .replace(/\s*\u0060\u0060\u0060$/i, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) throw new Error("模型没有返回 JSON");
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    throw new Error("模型输出不是合法 JSON");
  }
  return normalizeSummary(parsed);
}

/**
 * Summarize a transcript via local Ollama. Never throws — every failure is
 * reported as a typed error result.
 */
export async function summarizeTranscript(
  options: SummarizeOptions & { transcript: string },
): Promise<SummarizeResult> {
  const endpoint = options.endpoint ?? DEFAULT_ENDPOINT;
  const model = options.model ?? DEFAULT_MODEL;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const fetchImpl = options.fetchImpl ?? fetch;

  try {
    assertLocalEndpoint(endpoint);
  } catch (error) {
    return { ok: false, code: "ollama-unavailable", message: error instanceof Error ? error.message : String(error) };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();
  const url = endpoint.replace(/\/$/, "") + "/api/chat";

  try {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model,
        stream: false,
        format: "json",
        keep_alive: "5m",
        options: { temperature: 0.2, top_p: 0.9, num_ctx: 8192, num_predict: 500 },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: buildPrompt(options.transcript) },
        ],
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const body = await response.text();
      return {
        ok: false,
        code: "ollama-unavailable",
        message:
          response.status === 404
            ? "模型未安装：" + model + "（ollama pull " + model + "）"
            : "Ollama HTTP " + response.status + "：" + body.slice(0, 300),
      };
    }

    const data = (await response.json()) as {
      message?: { content?: string };
      eval_count?: number;
      eval_duration?: number;
    };
    const content = data.message?.content;
    if (typeof content !== "string" || content.length === 0) {
      return { ok: false, code: "invalid-json", message: "Ollama 返回为空" };
    }

    let memory: MemorySummary;
    try {
      memory = parseModelJson(content);
    } catch (error) {
      return { ok: false, code: "invalid-json", message: error instanceof Error ? error.message : String(error) };
    }

    const elapsedMs = Date.now() - startedAt;
    const evalCount = typeof data.eval_count === "number" ? data.eval_count : null;
    const evalDurationNs = typeof data.eval_duration === "number" ? data.eval_duration : null;
    const tokensPerSecond = evalCount !== null && evalDurationNs ? evalCount / (evalDurationNs / 1e9) : null;

    return { ok: true, memory, model, elapsedMs, evalTokens: evalCount, tokensPerSecond };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return { ok: false, code: "ollama-timeout", message: "Ollama 请求超时（" + timeoutMs + "ms）" };
    }
    if (error instanceof TypeError) {
      return { ok: false, code: "ollama-unavailable", message: "无法连接 Ollama（" + endpoint + "）" };
    }
    return { ok: false, code: "ollama-unavailable", message: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timer);
  }
}
