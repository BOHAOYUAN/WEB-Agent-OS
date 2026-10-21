import { describe, expect, it } from "vitest";
import { buildTranscript } from "../src/memory/transcript.js";
import type { SensorEvent } from "../src/types/events.js";

function delta(requestId: string, channel: "thinking" | "answer", text: string): SensorEvent {
  return { type: "sensor.text.delta", requestId, channel, text };
}

function userPrompt(requestId: string, text: string): SensorEvent {
  return { type: "sensor.user.prompt", requestId, text, ts: 0 };
}

describe("buildTranscript", () => {
  it("pairs user prompts with answer deltas by requestId", () => {
    const events: SensorEvent[] = [
      userPrompt("r1", "你好"),
      delta("r1", "answer", "你好！"),
      userPrompt("r2", "写代码"),
      delta("r2", "answer", "好的"),
    ];
    const result = buildTranscript(events);
    expect(result.hasUserPrompts).toBe(true);
    expect(result.turns).toBe(2);
    expect(result.transcript).toContain("用户：你好");
    expect(result.transcript).toContain("用户：写代码");
  });

  it("ignores thinking deltas", () => {
    const events: SensorEvent[] = [
      userPrompt("r1", "你好"),
      delta("r1", "thinking", "思考中"),
      delta("r1", "answer", "你好！"),
    ];
    const result = buildTranscript(events);
    expect(result.transcript).not.toContain("思考中");
    expect(result.transcript).toContain("你好！");
  });

  it("pairs correctly even when answer deltas precede the user prompt", () => {
    const events: SensorEvent[] = [delta("r1", "answer", "你好！"), userPrompt("r1", "你好")];
    const result = buildTranscript(events);
    expect(result.hasUserPrompts).toBe(true);
    expect(result.transcript).toContain("用户：你好");
    expect(result.transcript).toContain("你好！");
  });

  it("skips orphan user prompts with no answer", () => {
    const events: SensorEvent[] = [userPrompt("r1", "你好")];
    const result = buildTranscript(events);
    expect(result.transcript).toBe("");
    expect(result.hasUserPrompts).toBe(false);
  });

  it("falls back to assistant-only when no user prompts", () => {
    const events: SensorEvent[] = [delta("r1", "answer", "你好！")];
    const result = buildTranscript(events);
    expect(result.hasUserPrompts).toBe(false);
    expect(result.transcript).toContain("助手：你好！");
  });

  it("returns empty for empty events", () => {
    const result = buildTranscript([]);
    expect(result.transcript).toBe("");
    expect(result.turns).toBe(0);
    expect(result.hasUserPrompts).toBe(false);
  });

  it("keeps most recent turns and truncates the oldest beyond maxChars", () => {
    const events: SensorEvent[] = [];
    for (let index = 0; index < 10; index += 1) {
      events.push(userPrompt(`r${index}`, `问题${index}`));
      events.push(delta(`r${index}`, "answer", "回答".repeat(20)));
    }
    const full = buildTranscript(events);
    const truncated = buildTranscript(events, 100);
    expect(full.turns).toBe(10);
    expect(truncated.chars).toBeLessThanOrEqual(100);
    expect(truncated.transcript).toContain("问题9");
    expect(truncated.transcript).not.toContain("问题0");
  });
});
