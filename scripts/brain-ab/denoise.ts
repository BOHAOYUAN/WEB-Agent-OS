/**
 * V2 Brain — `denoise` task A/B gate (P7 spike, step 2).
 *
 * Separate from the memory gate on purpose: denoising only requires DELETE
 * decisions (drop the nav rail, keep the article), not the fact/plan boundary
 * judgment that broke the 1.5B model on memory summarization. A candidate can
 * fail one gate and pass the other, and that split decides what the browser
 * model is actually allowed to do.
 *
 * Thresholds are fixed here, before any result was observed.
 *
 * Usage: npx vite-node scripts/brain-ab/denoise.ts
 */

import { writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_ENDPOINT, DEFAULT_TIMEOUT_MS } from "@webos/actor";
import { DENOISE_SYSTEM_PROMPT, buildDenoisePrompt, parseDenoiseOutput } from "@webos/brain";
import { DENOISE_FIXTURES } from "./denoise-fixtures.js";

const BASELINE_MODEL = "qwen2.5:3b";
const CANDIDATE_MODEL = "qwen2.5:1.5b";

const GATE = {
  minJsonOkRate: 0.95,
  /** Kept-keyword retention relative to baseline. */
  minKeepRatio: 0.9,
  /** Noise-removal retention relative to baseline. */
  minDropRatio: 0.95,
  /** body length / input length. Above this the "denoise" is really a copy. */
  maxCompressionRatio: 0.5,
  rounds: 3,
} as const;

interface RawCall {
  content: string;
  elapsedMs: number;
}

async function callOllama(model: string, input: string): Promise<RawCall> {
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
        options: { temperature: 0.2, top_p: 0.9, num_ctx: 8192, num_predict: 1200 },
        messages: [
          { role: "system", content: DENOISE_SYSTEM_PROMPT },
          { role: "user", content: buildDenoisePrompt(input) },
        ],
      }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = (await response.json()) as { message?: { content?: string } };
    return { content: data.message?.content ?? "", elapsedMs: Date.now() - startedAt };
  } finally {
    clearTimeout(timer);
  }
}

interface SampleResult {
  fixtureId: string;
  jsonOk: boolean;
  error?: string;
  keepHit: number;
  keepTotal: number;
  dropClean: number;
  dropTotal: number;
  compressionRatio: number;
  bodyChars: number;
  elapsedMs: number;
}

async function runModel(model: string): Promise<SampleResult[]> {
  const results: SampleResult[] = [];
  for (const fixture of DENOISE_FIXTURES) {
    let raw: RawCall;
    try {
      raw = await callOllama(model, fixture.input);
    } catch (error) {
      results.push({
        fixtureId: fixture.id,
        jsonOk: false,
        error: error instanceof Error ? error.message : String(error),
        keepHit: 0,
        keepTotal: fixture.expected.keep.length,
        dropClean: 0,
        dropTotal: fixture.expected.drop.length,
        compressionRatio: 0,
        bodyChars: 0,
        elapsedMs: 0,
      });
      continue;
    }

    let title = "";
    let body = "";
    let ok = true;
    try {
      const parsed = parseDenoiseOutput(raw.content);
      title = parsed.title;
      body = parsed.body;
    } catch {
      ok = false;
    }

    const blob = `${title} ${body}`;
    results.push({
      fixtureId: fixture.id,
      jsonOk: ok,
      keepHit: fixture.expected.keep.filter((k) => blob.includes(k)).length,
      keepTotal: fixture.expected.keep.length,
      dropClean: fixture.expected.drop.filter((d) => !blob.includes(d)).length,
      dropTotal: fixture.expected.drop.length,
      compressionRatio: fixture.input.length === 0 ? 0 : body.length / fixture.input.length,
      bodyChars: body.length,
      elapsedMs: raw.elapsedMs,
    });
  }
  return results;
}

interface Aggregate {
  model: string;
  jsonOkRate: number;
  keepRate: number;
  dropRate: number;
  meanCompressionRatio: number;
  medianMs: number;
  perRoundKeep: number[];
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
  const keepTotal = sum((r) => r.keepTotal);
  const dropTotal = sum((r) => r.dropTotal);
  return {
    model,
    jsonOkRate: results.filter((r) => r.jsonOk).length / results.length,
    keepRate: keepTotal === 0 ? 1 : sum((r) => r.keepHit) / keepTotal,
    dropRate: dropTotal === 0 ? 1 : sum((r) => r.dropClean) / dropTotal,
    meanCompressionRatio: results.reduce((acc, r) => acc + r.compressionRatio, 0) / results.length,
    medianMs: median(results.map((r) => r.elapsedMs)),
    perRoundKeep: rounds.map((round) => {
      const total = round.reduce((acc, r) => acc + r.keepTotal, 0);
      return total === 0 ? 1 : round.reduce((acc, r) => acc + r.keepHit, 0) / total;
    }),
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
  const keepRatio = base.keepRate === 0 ? 1 : cand.keepRate / base.keepRate;
  check(
    keepRatio >= GATE.minKeepRatio,
    "正文保留率（相对基线）",
    `${(keepRatio * 100).toFixed(0)}%（${(cand.keepRate * 100).toFixed(0)}% vs ${(base.keepRate * 100).toFixed(0)}%）≥ ${(GATE.minKeepRatio * 100).toFixed(0)}%`,
  );
  const dropRatio = base.dropRate === 0 ? 1 : cand.dropRate / base.dropRate;
  check(
    dropRatio >= GATE.minDropRatio,
    "噪声剔除率（相对基线）",
    `${(dropRatio * 100).toFixed(0)}%（${(cand.dropRate * 100).toFixed(0)}% vs ${(base.dropRate * 100).toFixed(0)}%）≥ ${(GATE.minDropRatio * 100).toFixed(0)}%`,
  );
  check(
    cand.meanCompressionRatio <= GATE.maxCompressionRatio,
    "压缩比（body / 输入）",
    `${cand.meanCompressionRatio.toFixed(2)} ≤ ${GATE.maxCompressionRatio}（基线 ${base.meanCompressionRatio.toFixed(2)}）`,
  );
  return { pass, lines };
}

function markdown(base: Aggregate, cand: Aggregate, lines: string[], pass: boolean): string {
  const row = (label: string, a: string, b: string) => `| ${label} | ${a} | ${b} |`;
  return [
    "# Brain 降噪任务 A/B 报告",
    "",
    `结论：**${pass ? "PASS — 1.5B 可承担浏览器端降噪" : "FAIL — 降噪仍需 3B"}**`,
    "",
    `基线 \`${base.model}\` vs 候选 \`${cand.model}\`，样本 ${DENOISE_FIXTURES.length} 条 × ${GATE.rounds} 轮。`,
    "",
    "| 指标 | 基线 3B | 候选 1.5B |",
    "|---|---|---|",
    row("JSON 合规率", `${(base.jsonOkRate * 100).toFixed(0)}%`, `${(cand.jsonOkRate * 100).toFixed(0)}%`),
    row("正文保留率", `${(base.keepRate * 100).toFixed(0)}%`, `${(cand.keepRate * 100).toFixed(0)}%`),
    row("噪声剔除率", `${(base.dropRate * 100).toFixed(0)}%`, `${(cand.dropRate * 100).toFixed(0)}%`),
    row("压缩比（越低越好）", base.meanCompressionRatio.toFixed(2), cand.meanCompressionRatio.toFixed(2)),
    row("中位延迟", `${base.medianMs} ms`, `${cand.medianMs} ms`),
    row(
      "各轮保留率",
      base.perRoundKeep.map((v) => `${(v * 100).toFixed(0)}%`).join(" / "),
      cand.perRoundKeep.map((v) => `${(v * 100).toFixed(0)}%`).join(" / "),
    ),
    "",
    "## 门禁判定",
    "",
    ...lines,
    "",
    "阈值固定在 `scripts/brain-ab/denoise.ts` 顶部。样本为合成的带噪声页面文本。",
    "",
  ].join("\n");
}

async function main(): Promise<void> {
  const tagsResponse = await fetch(`${DEFAULT_ENDPOINT}/api/tags`);
  const tags = (await tagsResponse.json()) as { models?: { name: string }[] };
  const available = (tags.models ?? []).map((m) => m.name);
  for (const model of [BASELINE_MODEL, CANDIDATE_MODEL]) {
    if (!available.some((name) => name === model || name.startsWith(`${model}:`))) {
      console.error(`模型未就绪：${model}`);
      process.exitCode = 1;
      return;
    }
  }

  const runRounds = async (model: string): Promise<SampleResult[][]> => {
    const rounds: SampleResult[][] = [];
    for (let round = 1; round <= GATE.rounds; round += 1) {
      console.log(`${model} 第 ${round}/${GATE.rounds} 轮（${DENOISE_FIXTURES.length} 条）…`);
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
  const reportPath = join(here, "..", "..", "docs", "brain-denoise-report.md");
  const rawPath = join(here, "..", "..", ".tmp-e2e", "brain-denoise-raw.json");
  await mkdir(dirname(rawPath), { recursive: true });
  await writeFile(reportPath, markdown(base, cand, lines, pass), "utf8");
  await writeFile(
    rawPath,
    JSON.stringify({ generatedAt: new Date().toISOString(), gate: GATE, baseline: baseRounds, candidate: candRounds }, null, 2),
    "utf8",
  );

  console.log("");
  console.log(markdown(base, cand, lines, pass));
  console.log(`\n报告：docs/brain-denoise-report.md\n原始输出：.tmp-e2e/brain-denoise-raw.json`);
  process.exitCode = pass ? 0 : 1;
}

await main();
