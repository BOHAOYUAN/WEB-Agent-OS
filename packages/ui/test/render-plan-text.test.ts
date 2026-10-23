import { describe, expect, it } from "vitest";
import type { Artifact, ArtifactRenderPlan } from "@webos/shared";
import { classifyLanguage, renderArtifactSrcdoc, runtimeForLanguage } from "@webos/shared";
import { describeRenderPlan } from "../src/render-plan-text.js";

/**
 * The plans under test are produced by `renderArtifactSrcdoc`, not hand-built:
 * that way the test breaks if the producer and the explanation drift apart (a
 * renamed reason, or a new one nobody explains).
 */
function planFor(language: string, code = "x"): ArtifactRenderPlan {
  const artifact: Artifact = {
    id: "artifact-0",
    index: 0,
    language,
    code,
    kind: classifyLanguage(language),
    runtime: runtimeForLanguage(language),
  };
  return renderArtifactSrcdoc(artifact);
}

describe("describeRenderPlan", () => {
  it("explains a language that cannot be rendered", () => {
    const plan = planFor("python");
    expect(plan.kind).toBe("code");
    expect(describeRenderPlan(plan)).toBe("该语言不支持渲染，仅展示代码");
  });

  it("explains a missing React runtime", () => {
    const plan = planFor("jsx");
    expect(plan.kind).toBe("code");
    expect(describeRenderPlan(plan)).toBe("JSX 运行时未加载，仅展示代码");
  });

  it("explains an oversized artifact", () => {
    const plan = planFor("html", "x".repeat(300 * 1024));
    expect(plan.kind).toBe("code");
    expect(describeRenderPlan(plan)).toBe("代码过大，仅展示代码");
  });

  it("says nothing for a renderable artifact", () => {
    const plan = planFor("html");
    expect(plan.kind).toBe("render");
    expect(describeRenderPlan(plan)).toBe("");
  });

  it("falls back to the truncated flag when no reason is given", () => {
    const base = { srcdoc: "", sandbox: "", kind: "code", runtime: "html" } as const;
    expect(describeRenderPlan({ ...base, truncated: true })).toBe("代码过大，仅展示代码");
    expect(describeRenderPlan({ ...base, truncated: false })).toBe("仅展示代码");
  });
});
