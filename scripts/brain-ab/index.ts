/**
 * V2 Brain — model A/B quality gate (P7 spike, step 1).
 *
 * Question it answers: can a 1.5B model replace (or degrade gracefully from)
 * the current 3B Ollama model for memory summarization inside the browser?
 *
 * Design rules:
 *  - Runs the EXACT production prompt + post-processing (imported from
 *    @webos/actor), so a pass here means "the real system works", not "a
 *    copy of the system works".
 *  - Captures the RAW model output before the deterministic facts boundary
 *    guard, because the guard hides the failure mode we care about: a model
 *    that writes plans into `facts` produces empty facts after the guard
 *    relocates them — silently degraded memory, not a crash.
 *  - Rounded: at the production temperature (0.2) a single round produced
 *    materially different verdicts on consecutive runs (candidate recall swung
 *    59% → 35%). A one-shot verdict would have been noise, so each model runs
 *    N rounds and the spread is reported alongside the mean.
 *  - Thresholds are fixed HERE, before any result is known.
 *
 * Usage: npx vite-node scripts/brain-ab/index.ts
 */

import { writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  SYSTEM_PROMPT,
  buildPrompt,
  parseModelJson,
  FUTURE_MARKER,
  DEFAULT_ENDPOINT,
  DEFAULT_TIMEOUT_MS,
  MAX_FACT_CHARS,
  MAX_SUMMARY_CHARS,
} from "@webos/actor";
import { FIXTURES } from "./fixtures.js";

const BASELINE_MODEL = "qwen2.5:3b";
const CANDIDATE_MODEL = "qwen2.5:1.5b";

/** Fixed BEFORE any result was observed. Do not tune after seeing output. */
const GATE = {
  minJsonOkRate: 0.95,
  /** Candidate recall must retain at least this fraction of baseline recall. */
  minRecallRatio: 0.85,
  /** Candidate raw-facts boundary violations, absolute ceiling. */
  maxBoundaryViolationRate: 0.25,
  /** ...and no more than this multiple of the baseline rate. */
  maxBoundaryViolationRatio: 1.5,
  /** Candidate open-loop placement must retain this fraction of baseline. */
  minOpenLoopRatio: 0.8,
  /**
   * Raw `facts` text as a fraction of the input transcript. A summarizer that
   * copies the transcript verbatim into facts scores ~1.0 and is worse than
   * useless: it defeats the "raw transcript never touches disk" red line.
   */
  maxCompressionRatio: 0.35,
  /** Rounds per model — see the "Rounded" note in the header. */
  rounds: 3,
} as const;

/** Length contract comes from production (@webos/actor), never from here. */

interface RawCall {
  content: string;
  elapsedMs: number;
  evalTokens: number | null;
  tokensPerSecond: number | null;
}

interface SampleResult {
  fixtureId: string;
  jsonOk: boolean;
  error?: string;
  /** Facts violating the future-tense marker, measured BEFORE the guard. */
  rawFacts: string[];
  rawViolations: number;
  /** Guard output — what production would actually persist. */
  facts: string[];
  openLoops: string[];
  preferences: string[];
  summary: string;
  recallHit: number;
  recallTotal: number;
  openLoopHit: number;
  openLoopTotal: number;
  prefHit: number;
  prefTotal: number;
  overLongFacts: number;
  summaryOverLong: boolean;
  /** facts text / input length. Near 1.0 means the model copied the transcript. */
  compressionRatio: number;
  elapsedMs: number;
  tokensPerSecond: number | null;
}

async function callOllama(model: string, transcript: string): Promise<RawCall> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS * 2);
  const startedAt = Date.now();
  try {
    const response = await fetch(`${DEFAULT_ENDPOINT}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model,
        stream: false,
        format: "json",
        keep_alive: "10m",
        options: { temperature: 0.2, top_p: 0.9, num_ctx: 8192, num_predict: 500 },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: buildPrompt(transcript) },
        ],
      }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = (await response.json()) as {
      message?: { content?: string };
      eval_count?: number;
      eval_duration?: number;
    };
    const content = data.message?.content ?? "";
    const evalCount = typeof data.eval_count === "number" ? data.eval_count : null;
    const evalNs = typeof data.eval_duration === "number" ? data.eval_duration : null;
    return {
      content,
      elapsedMs: Date.now() - startedAt,
      evalTokens: evalCount,
      tokensPerSecond: evalCount !== null && evalNs ? evalCount / (evalNs / 1e9) : null,
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Raw facts as the model wrote them, before any guard. */
function readRawFacts(content: string): string[] {
  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");
  if (start === -1 || end === -1) return [];
  try {
    const parsed = JSON.parse(content.slice(start, end + 1)) as { facts?: unknown };
    if (!Array.isArray(parsed.facts)) return [];
    return parsed.facts.filter((item): item is string => typeof item === "string");
  } catch {
    return [];
  }
}

function hits(haystack: string, needles: string[]): number {
  return needles.filter((needle) => haystack.includes(needle)).length;
}

async function runModel(model: string): Promise<SampleResult[]> {
  const results: SampleResult[] = [];
  for (const fixture of FIXTURES) {
    let raw: RawCall;
    try {
      raw = await callOllama(model, fixture.transcript);
    } catch (error) {
      results.push({
        fixtureId: fixture.id,
        jsonOk: false,
        error: error instanceof Error ? error.message : String(error),
        rawFacts: [],
        rawViolations: 0,
        facts: [],
        openLoops: [],
        preferences: [],
        summary: "",
        recallHit: 0,
        recallTotal: fixture.expected.recall.length,
        openLoopHit: 0,
        openLoopTotal: fixture.expected.mustBeOpenLoop.length,
        prefHit: 0,
        prefTotal: fixture.expected.mustBePreference.length,
        overLongFacts: 0,
        summaryOverLong: false,
        compressionRatio: 0,
        elapsedMs: 0,
        tokensPerSecond: null,
      });
      continue;
    }

    const rawFacts = readRawFacts(raw.content);
    const rawViolations = rawFacts.filter((fact) => FUTURE_MARKER.test(fact)).length;

    let memory: ReturnType<typeof parseModelJson> | null = null;
    try {
      memory = parseModelJson(raw.content);
    } catch {
      memory = null;
    }

    const blob = memory
      ? [memory.facts, memory.preferences, memory.decisions, memory.open_loops, [memory.summary]]
          .flat()
          .join(" ")
      : "";

    results.push({
      fixtureId: fixture.id,
      jsonOk: memory !== null,
      rawFacts,
      rawViolations,
      facts: memory?.facts ?? [],
      openLoops: memory?.open_loops ?? [],
      preferences: memory?.preferences ?? [],
      summary: memory?.summary ?? "",
      recallHit: hits(blob, fixture.expected.recall),
      recallTotal: fixture.expected.recall.length,
      openLoopHit: memory ? hits(memory.open_loops.join(" "), fixture.expected.mustBeOpenLoop) : 0,
      openLoopTotal: fixture.expected.mustBeOpenLoop.length,
      prefHit: memory ? hits(memory.preferences.join(" "), fixture.expected.mustBePreference) : 0,
      prefTotal: fixture.expected.mustBePreference.length,
      overLongFacts: (memory?.facts ?? []).filter((f) => f.length > MAX_FACT_CHARS).length,
      summaryOverLong: (memory?.summary.length ?? 0) > MAX_SUMMARY_CHARS,
      compressionRatio:
        fixture.transcript.length === 0
          ? 0
          : rawFacts.reduce((acc, f) => acc + f.length, 0) / fixture.transcript.length,
      elapsedMs: raw.elapsedMs,
      tokensPerSecond: raw.tokensPerSecond,
    });
  }
  return results;
}

interface Aggregate {
  model: string;
  jsonOkRate: number;
  recallRate: number;
  boundaryViolationRate: number;
  openLoopRate: number;
  prefRate: number;
  medianMs: number;
  medianTokensPerSecond: number | null;
  overLongFactRate: number;
  meanCompressionRatio: number;
  /** Recall per round — spread matters as much as the mean. */
  perRoundRecall: number[];
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function aggregate(model: string, rounds: SampleResult[][]): Aggregate {
  const results = rounds.flat();
  const sum = (pick: (r: SampleResult) => number) => results.reduce((acc, r) => acc + pick(r), 0);
  const perRoundRecall = rounds.map((round) => {
    const total = round.reduce((acc, r) => acc + r.recallTotal, 0);
    return total === 0 ? 1 : round.reduce((acc, r) => acc + r.recallHit, 0) / total;
  });
  const recallTotal = sum((r) => r.recallTotal);
  const openLoopTotal = sum((r) => r.openLoopTotal);
  const prefTotal = sum((r) => r.prefTotal);
  const rawFactTotal = sum((r) => r.rawFacts.length);
  const factTotal = sum((r) => r.facts.length);
  return {
    model,
    jsonOkRate: results.filter((r) => r.jsonOk).length / results.length,
    recallRate: recallTotal === 0 ? 1 : sum((r) => r.recallHit) / recallTotal,
    boundaryViolationRate: rawFactTotal === 0 ? 0 : sum((r) => r.rawViolations) / rawFactTotal,
    openLoopRate: openLoopTotal === 0 ? 1 : sum((r) => r.openLoopHit) / openLoopTotal,
    prefRate: prefTotal === 0 ? 1 : sum((r) => r.prefHit) / prefTotal,
    medianMs: median(results.map((r) => r.elapsedMs)),
    medianTokensPerSecond: median(results.map((r) => r.tokensPerSecond ?? 0)) || null,
    overLongFactRate: factTotal === 0 ? 0 : sum((r) => r.overLongFacts) / factTotal,
    meanCompressionRatio: results.reduce((acc, r) => acc + r.compressionRatio, 0) / results.length,
    perRoundRecall,
  };
}

function verdict(base: Aggregate, cand: Aggregate): { pass: boolean; lines: string[] } {
  const lines: string[] = [];
  let pass = true;
  const check = (ok: boolean, label: string, detail: string) => {
    lines.push(`- ${ok ? "PASS" : "FAIL"} ${label} — ${detail}`);
    if (!ok) pass = false;
  };

  check(
    cand.jsonOkRate >= GATE.minJsonOkRate,
    "JSON 合规率",
    `${(cand.jsonOkRate * 100).toFixed(0)}% ≥ ${(GATE.minJsonOkRate * 100).toFixed(0)}%`,
  );
  const recallRatio = base.recallRate === 0 ? 1 : cand.recallRate / base.recallRate;
  check(
    recallRatio >= GATE.minRecallRatio,
    "召回率保持比",
    `${(recallRatio * 100).toFixed(0)}% of baseline（${(cand.recallRate * 100).toFixed(0)}% vs ${(base.recallRate * 100).toFixed(0)}%）≥ ${(GATE.minRecallRatio * 100).toFixed(0)}%`,
  );
  check(
    cand.boundaryViolationRate <= GATE.maxBoundaryViolationRate,
    "facts 边界违规（绝对值）",
    `${(cand.boundaryViolationRate * 100).toFixed(0)}% ≤ ${(GATE.maxBoundaryViolationRate * 100).toFixed(0)}%`,
  );
  const violationRatio =
    base.boundaryViolationRate === 0 ? (cand.boundaryViolationRate === 0 ? 0 : Infinity) : cand.boundaryViolationRate / base.boundaryViolationRate;
  check(
    violationRatio <= GATE.maxBoundaryViolationRatio,
    "facts 边界违规（相对基线）",
    `${Number.isFinite(violationRatio) ? violationRatio.toFixed(2) : "∞"}x ≤ ${GATE.maxBoundaryViolationRatio}x`,
  );
  const openLoopRatio = base.openLoopRate === 0 ? 1 : cand.openLoopRate / base.openLoopRate;
  check(
    openLoopRatio >= GATE.minOpenLoopRatio,
    "open_loops 归因保持比",
    `${(openLoopRatio * 100).toFixed(0)}% of baseline ≥ ${(GATE.minOpenLoopRatio * 100).toFixed(0)}%`,
  );
  check(
    cand.meanCompressionRatio <= GATE.maxCompressionRatio,
    "压缩比（facts 文本 / 输入长度）",
    `${cand.meanCompressionRatio.toFixed(2)} ≤ ${GATE.maxCompressionRatio}（基线 ${base.meanCompressionRatio.toFixed(2)}）`,
  );
  return { pass, lines };
}

function markdown(base: Aggregate, cand: Aggregate, lines: string[], pass: boolean): string {
  const row = (label: string, a: string, b: string) => `| ${label} | ${a} | ${b} |`;
  return [
    "# Brain 模型 A/B 质量门禁报告",
    "",
    `结论：**${pass ? "PASS — 1.5B 可作为降级通道" : "FAIL — 1.5B 不达标"}**`,
    "",
    `基线 \`${base.model}\` vs 候选 \`${cand.model}\`，样本 ${FIXTURES.length} 条 × ${GATE.rounds} 轮 = 每模型 ${FIXTURES.length * GATE.rounds} 次推理。`,
    "",
    "## 聚合指标",
    "",
    "| 指标 | 基线 3B | 候选 1.5B |",
    "|---|---|---|",
    row("JSON 合规率", `${(base.jsonOkRate * 100).toFixed(0)}%`, `${(cand.jsonOkRate * 100).toFixed(0)}%`),
    row("事实召回率", `${(base.recallRate * 100).toFixed(0)}%`, `${(cand.recallRate * 100).toFixed(0)}%`),
    row(
      "facts 边界违规率（守卫前）",
      `${(base.boundaryViolationRate * 100).toFixed(0)}%`,
      `${(cand.boundaryViolationRate * 100).toFixed(0)}%`,
    ),
    row("open_loops 归因率", `${(base.openLoopRate * 100).toFixed(0)}%`, `${(cand.openLoopRate * 100).toFixed(0)}%`),
    row("preferences 归因率", `${(base.prefRate * 100).toFixed(0)}%`, `${(cand.prefRate * 100).toFixed(0)}%`),
    row("facts 超字数率", `${(base.overLongFactRate * 100).toFixed(0)}%`, `${(cand.overLongFactRate * 100).toFixed(0)}%`),
    row(
      "压缩比（越低越好，>0.35 视为在抄原文）",
      base.meanCompressionRatio.toFixed(2),
      cand.meanCompressionRatio.toFixed(2),
    ),
    row("中位延迟", `${base.medianMs} ms`, `${cand.medianMs} ms`),
    row(
      "中位生成速度",
      base.medianTokensPerSecond === null ? "n/a" : `${base.medianTokensPerSecond.toFixed(1)} tok/s`,
      cand.medianTokensPerSecond === null ? "n/a" : `${cand.medianTokensPerSecond.toFixed(1)} tok/s`,
    ),
    row(
      "各轮召回率",
      base.perRoundRecall.map((v) => `${(v * 100).toFixed(0)}%`).join(" / "),
      cand.perRoundRecall.map((v) => `${(v * 100).toFixed(0)}%`).join(" / "),
    ),
    "",
    "## 门禁判定",
    "",
    ...lines,
    "",
    "阈值在 `scripts/brain-ab/index.ts` 顶部固定，跑之前就写死，不做事后调整。",
    "",
    "样本为按本项目真实素材风格编写的合成对话（非抓取的用户数据）。",
    "",
  ].join("\n");
}

async function main(): Promise<void> {
  const tagsResponse = await fetch(`${DEFAULT_ENDPOINT}/api/tags`);
  const tags = (await tagsResponse.json()) as { models?: { name: string }[] };
  const available = (tags.models ?? []).map((m) => m.name);
  for (const model of [BASELINE_MODEL, CANDIDATE_MODEL]) {
    const present = available.some((name) => name === model || name.startsWith(`${model}:`));
    if (!present) {
      console.error(`模型未就绪：${model}。请先在终端执行 ollama pull ${model}`);
      process.exitCode = 1;
      return;
    }
  }

  const runRounds = async (model: string): Promise<SampleResult[][]> => {
    const rounds: SampleResult[][] = [];
    for (let round = 1; round <= GATE.rounds; round += 1) {
      console.log(`${model} 第 ${round}/${GATE.rounds} 轮（${FIXTURES.length} 条）…`);
      rounds.push(await runModel(model));
    }
    return rounds;
  };

  const baseRounds = await runRounds(BASELINE_MODEL);
  const candRounds = await runRounds(CANDIDATE_MODEL);

  const base = aggregate(BASELINE_MODEL, baseRounds);
  const cand = aggregate(CANDIDATE_MODEL, candRounds);
  const { pass, lines } = verdict(base, cand);

  const here = dirname(fileURLToPath(import.meta.url));
  const reportPath = join(here, "..", "..", "docs", "brain-ab-report.md");
  const rawPath = join(here, "..", "..", ".tmp-e2e", "brain-ab-raw.json");
  await mkdir(dirname(rawPath), { recursive: true });
  await writeFile(reportPath, markdown(base, cand, lines, pass), "utf8");
  await writeFile(
    rawPath,
    JSON.stringify({ generatedAt: new Date().toISOString(), gate: GATE, baseline: baseRounds, candidate: candRounds }, null, 2),
    "utf8",
  );

  console.log("");
  console.log(markdown(base, cand, lines, pass));
  console.log(`\n报告：docs/brain-ab-report.md\n原始输出：.tmp-e2e/brain-ab-raw.json`);
  process.exitCode = pass ? 0 : 1;
}

await main();
