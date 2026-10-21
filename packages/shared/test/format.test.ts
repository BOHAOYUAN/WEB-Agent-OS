import { describe, expect, it } from "vitest";
import { formatMemoryForPrompt } from "../src/memory/format.js";

const FULL_MEMORY = {
  summary: "本次对话完成登录修复。",
  facts: ["登录已修复"],
  preferences: ["偏好简洁回复"],
  decisions: ["用 JSON 存储记忆"],
  open_loops: ["待验证性能"],
};

describe("formatMemoryForPrompt", () => {
  it("renders summary → facts → preferences → decisions → open loops in order", () => {
    const out = formatMemoryForPrompt(FULL_MEMORY);
    const idxSummary = out.indexOf("本次对话完成登录修复");
    const idxFact = out.indexOf("事实");
    const idxPref = out.indexOf("偏好");
    const idxDec = out.indexOf("决策");
    const idxOpen = out.indexOf("待办");
    expect(idxSummary).toBe(0);
    expect(idxFact).toBeGreaterThan(idxSummary);
    expect(idxPref).toBeGreaterThan(idxFact);
    expect(idxDec).toBeGreaterThan(idxPref);
    expect(idxOpen).toBeGreaterThan(idxDec);
  });

  it("omits empty fields", () => {
    const out = formatMemoryForPrompt({
      summary: "",
      facts: [],
      preferences: ["p"],
      decisions: [],
      open_loops: [],
    });
    expect(out).toBe("偏好\n- p");
  });

  it("returns an empty string for an empty memory", () => {
    expect(formatMemoryForPrompt({ summary: "", facts: [], preferences: [], decisions: [], open_loops: [] })).toBe("");
  });

  it("truncates to maxChars on whole-line boundaries", () => {
    const full = formatMemoryForPrompt(FULL_MEMORY);
    expect(full.length).toBeGreaterThan(30);
    const truncated = formatMemoryForPrompt(FULL_MEMORY, 20);
    expect(truncated.length).toBeLessThanOrEqual(20);
    expect(full.startsWith(truncated)).toBe(true);
  });

  it("never exceeds maxChars for a large memory", () => {
    const memory = {
      summary: "长摘要。".repeat(50),
      facts: ["事实一".repeat(30), "事实二".repeat(30)],
      preferences: ["偏好".repeat(30)],
      decisions: ["决策".repeat(30)],
      open_loops: ["待办".repeat(30)],
    };
    const out = formatMemoryForPrompt(memory, 600);
    expect(out.length).toBeLessThanOrEqual(600);
  });
});
