import { describe, expect, it } from "vitest";
import { RuleRouter, classifyIntent, personaForIntent } from "../src/index.js";
import type { RouterContext } from "../src/index.js";
import type { SensorEvent } from "@webos/shared";

function delta(text: string): SensorEvent {
  return { type: "sensor.text.delta", requestId: "r1", channel: "answer", text };
}

function end(): SensorEvent {
  return { type: "sensor.stream.end", requestId: "r1", reason: "finished", ts: 1 };
}

const ctx: RouterContext = { tabId: 1, pageSessionId: "s1" };

describe("classifyIntent", () => {
  it("classifies code intent", () => {
    expect(classifyIntent("帮我重构这段 TypeScript 代码").intent).toBe("code");
  });

  it("classifies finance intent", () => {
    expect(classifyIntent("分析一下这家公司的现金流和毛利率").intent).toBe("finance");
  });

  it("classifies writing intent", () => {
    expect(classifyIntent("帮我润色这段演讲稿").intent).toBe("writing");
  });

  it("falls back to general for unknown text", () => {
    const result = classifyIntent("今天天气怎么样");
    expect(result.intent).toBe("general");
    expect(result.confidence).toBe(0);
  });

  it("returns general with no match for empty text", () => {
    expect(classifyIntent("").intent).toBe("general");
  });
});

describe("personaForIntent", () => {
  it("resolves the code persona", () => {
    expect(personaForIntent("code").id).toBe("code-fiend");
  });

  it("falls back to generalist for unknown intent", () => {
    expect(personaForIntent("general").id).toBe("generalist");
  });
});

describe("RuleRouter", () => {
  it("is inert (noop) when disabled by default", () => {
    const router = new RuleRouter();
    expect(router.onSensorEvent(delta("帮我写一段代码"), ctx)).toEqual({ kind: "noop" });
  });

  it("emits a persona prompt when enabled and intent matches", () => {
    const router = new RuleRouter({ enabled: true });
    const decision = router.onSensorEvent(delta("帮我重构这段代码"), ctx);
    expect(decision.kind).toBe("send-prompt");
    if (decision.kind === "send-prompt") {
      expect(decision.reason).toContain("intent=code");
      expect(decision.prompt.length).toBeGreaterThan(0);
    }
  });

  it("stays silent on general intent when injectGeneral is false", () => {
    const router = new RuleRouter({ enabled: true });
    expect(router.onSensorEvent(delta("今天天气怎么样"), ctx)).toEqual({ kind: "noop" });
  });

  it("emits for general intent when injectGeneral is true", () => {
    const router = new RuleRouter({ enabled: true, injectGeneral: true });
    const decision = router.onSensorEvent(delta("随便聊聊"), ctx);
    expect(decision.kind).toBe("send-prompt");
  });

  it("emits at most once per turn (no delta-level flapping)", () => {
    const router = new RuleRouter({ enabled: true });
    const first = router.onSensorEvent(delta("帮我写代码"), ctx);
    const second = router.onSensorEvent(delta("继续"), ctx);
    const third = router.onSensorEvent(delta("再继续"), ctx);
    expect(first.kind).toBe("send-prompt");
    expect(second).toEqual({ kind: "noop" });
    expect(third).toEqual({ kind: "noop" });
  });

  it("emits again after stream end resets the turn", () => {
    const router = new RuleRouter({ enabled: true });
    expect(router.onSensorEvent(delta("帮我写代码"), ctx).kind).toBe("send-prompt");
    router.onSensorEvent(end(), ctx);
    expect(router.onSensorEvent(delta("帮我写代码"), ctx).kind).toBe("send-prompt");
  });

  it("setEnabled(true) activates a router constructed disabled", () => {
    const router = new RuleRouter();
    expect(router.onSensorEvent(delta("帮我写代码"), ctx)).toEqual({ kind: "noop" });
    router.setEnabled(true);
    expect(router.onSensorEvent(delta("帮我写代码"), ctx).kind).toBe("send-prompt");
  });

  it("setEnabled(false) disables and resets the current turn", () => {
    const router = new RuleRouter({ enabled: true });
    router.setEnabled(false);
    expect(router.onSensorEvent(delta("帮我写代码"), ctx)).toEqual({ kind: "noop" });
  });
});
