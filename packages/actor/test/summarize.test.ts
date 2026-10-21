import { describe, expect, it } from "vitest";
import {
  FUTURE_MARKER,
  MAX_PROMPT_CHARS,
  buildPrompt,
  enforceFactsBoundary,
  normalizeSummary,
  parseModelJson,
  summarizeTranscript,
} from "../src/memory/summarize.js";

function mockFetch(opts: {
  ok?: boolean;
  status?: number;
  content?: string;
  body?: unknown;
  throwError?: unknown;
}): typeof fetch {
  return (async () => {
    if (opts.throwError !== undefined) throw opts.throwError;
    return {
      ok: opts.ok ?? true,
      status: opts.status ?? 200,
      text: async () => "",
      json: async () => opts.body ?? { message: { content: opts.content } },
    };
  }) as unknown as typeof fetch;
}

describe("buildPrompt", () => {
  it("embeds the transcript and requests strict JSON", () => {
    const prompt = buildPrompt("用户：你好\n助手：你好");
    expect(prompt).toContain("用户：你好");
    expect(prompt).toContain("facts");
    expect(prompt).toContain("只输出 JSON");
  });

  it("clips oversized transcripts to MAX_PROMPT_CHARS", () => {
    const big = "x".repeat(20 * 1024);
    const prompt = buildPrompt(big);
    expect(prompt.length).toBeLessThan(MAX_PROMPT_CHARS + 2048);
  });
});

describe("normalizeSummary", () => {
  it("keeps only string array items and truncates", () => {
    const memory = normalizeSummary({
      facts: ["a", "b", 123, null, ""],
      preferences: ["p"],
      decisions: [],
      open_loops: [],
      summary: "s",
    });
    expect(memory.facts).toEqual(["a", "b"]);
    expect(memory.preferences).toEqual(["p"]);
    expect(memory.summary).toBe("s");
  });

  it("throws on non-object input", () => {
    expect(() => normalizeSummary(null)).toThrow();
    expect(() => normalizeSummary([1, 2])).toThrow();
  });

  it("relocates future-tense facts into open_loops (model hallucination guard)", () => {
    const memory = normalizeSummary({
      facts: ["Stage 1 已完成并通过验证", "下一步做 Stage 2 的 SystemContext 合并注入"],
      preferences: [],
      decisions: [],
      open_loops: [],
      summary: "s",
    });
    expect(memory.facts).toEqual(["Stage 1 已完成并通过验证"]);
    expect(memory.open_loops).toContain("下一步做 Stage 2 的 SystemContext 合并注入");
  });

  it("does not duplicate displaced items already present in open_loops", () => {
    const memory = enforceFactsBoundary({
      facts: ["计划下周复测"],
      preferences: [],
      decisions: [],
      open_loops: ["计划下周复测"],
      summary: "",
    });
    expect(memory.facts).toEqual([]);
    expect(memory.open_loops).toEqual(["计划下周复测"]);
  });

  it("prompt itself forbids plans in facts (few-shot guard)", () => {
    const prompt = buildPrompt("用户：下一步做什么？\n助手：做 Stage 2");
    expect(prompt).toContain("绝不能放 facts");
    expect(prompt).toContain("判定示例");
  });
});

describe("FUTURE_MARKER", () => {
  it("matches the observed hallucination pattern", () => {
    expect(FUTURE_MARKER.test("Stage 2 SystemContext 合并注入即将做")).toBe(false);
    expect(FUTURE_MARKER.test("下一步做 Stage 2")).toBe(true);
    expect(FUTURE_MARKER.test("计划下周复测")).toBe(true);
    expect(FUTURE_MARKER.test("Stage 1 已完成并通过验证")).toBe(false);
  });
});

describe("parseModelJson", () => {
  it("strips markdown fences and parses", () => {
    const json = parseModelJson(
      '```json\n{"facts":["f"],"preferences":[],"decisions":[],"open_loops":[],"summary":"s"}\n```',
    );
    expect(json.summary).toBe("s");
    expect(json.facts).toEqual(["f"]);
  });

  it("throws on non-JSON output", () => {
    expect(() => parseModelJson("not json at all")).toThrow();
  });
});

describe("summarizeTranscript", () => {
  it("returns a typed memory on success", async () => {
    const result = await summarizeTranscript({
      transcript: "hello",
      fetchImpl: mockFetch({ content: '{"facts":["f"],"preferences":[],"decisions":[],"open_loops":[],"summary":"s"}' }),
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.memory.summary).toBe("s");
      expect(result.model).toBe("qwen2.5:3b");
    }
  });

  it("returns ollama-unavailable on connection failure", async () => {
    const result = await summarizeTranscript({
      transcript: "hello",
      fetchImpl: mockFetch({ throwError: new TypeError("fetch failed") }),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("ollama-unavailable");
  });

  it("returns ollama-timeout on abort", async () => {
    const abort = Object.assign(new Error("aborted"), { name: "AbortError" });
    const result = await summarizeTranscript({
      transcript: "hello",
      fetchImpl: mockFetch({ throwError: abort }),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("ollama-timeout");
  });

  it("returns invalid-json on malformed model output", async () => {
    const result = await summarizeTranscript({
      transcript: "hello",
      fetchImpl: mockFetch({ content: "no json here" }),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("invalid-json");
  });

  it("rejects a non-local endpoint (SSRF guard)", async () => {
    const result = await summarizeTranscript({
      transcript: "hello",
      endpoint: "http://evil.example.com:11434",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("ollama-unavailable");
  });
});
