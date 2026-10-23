import { describe, expect, it } from "vitest";
import {
  buildDenoisePrompt,
  parseDenoiseOutput,
  DEFAULT_DENOISE_MAX_CHARS,
  DENOISE_SYSTEM_PROMPT,
} from "../src/prompts.js";

describe("buildDenoisePrompt", () => {
  it("embeds the expected output shape", () => {
    const prompt = buildDenoisePrompt("页面文本");
    expect(prompt).toContain('"title"');
    expect(prompt).toContain('"body"');
    expect(prompt).toContain('"dropped"');
    expect(prompt).toContain("页面文本");
  });

  it("clips oversized input instead of throwing", () => {
    const input = "x".repeat(DEFAULT_DENOISE_MAX_CHARS + 500);
    const prompt = buildDenoisePrompt(input);
    expect(prompt.length).toBeLessThan(input.length + 1000);
  });

  it("states the copy ban, because small models copy by default", () => {
    expect(DENOISE_SYSTEM_PROMPT).toContain("不要新增");
    expect(buildDenoisePrompt("x")).toContain("绝不能整段照抄");
  });
});

describe("parseDenoiseOutput", () => {
  it("parses a well-formed response", () => {
    const result = parseDenoiseOutput('{"title":"标题","body":"正文","dropped":["导航栏"]}');
    expect(result.title).toBe("标题");
    expect(result.body).toBe("正文");
    expect(result.dropped).toEqual(["导航栏"]);
  });

  it("accepts fenced output", () => {
    const result = parseDenoiseOutput('```json\n{"title":"T","body":"B","dropped":[]}\n```');
    expect(result.title).toBe("T");
  });

  it("extracts JSON from surrounding prose", () => {
    const result = parseDenoiseOutput('好的：{"title":"T","body":"B","dropped":[]} 希望有用');
    expect(result.body).toBe("B");
  });

  it("throws on non-JSON output", () => {
    expect(() => parseDenoiseOutput("抱歉，我无法处理")).toThrow();
  });

  it("throws on empty output", () => {
    expect(() => parseDenoiseOutput("")).toThrow();
  });

  it("drops non-string entries from dropped and caps at five", () => {
    const result = parseDenoiseOutput(
      '{"title":"T","body":"B","dropped":["a",2,null,"b","c","d","e","f"]}',
    );
    expect(result.dropped).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("tolerates a missing dropped array", () => {
    const result = parseDenoiseOutput('{"title":"T","body":"B"}');
    expect(result.dropped).toEqual([]);
  });

  it("caps body length so a runaway model cannot flood the context", () => {
    const result = parseDenoiseOutput(`{"title":"T","body":"${"y".repeat(9000)}","dropped":[]}`);
    expect(result.body.length).toBeLessThanOrEqual(3000);
  });
});
