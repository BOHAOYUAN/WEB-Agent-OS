import { describe, expect, it } from "vitest";
import {
  extractArtifacts,
  renderArtifactSrcdoc,
  runtimeForLanguage,
} from "../src/artifacts/artifacts.js";
import {
  artifactHarnessScript,
  buildFeedbackMessage,
  formatFeedbackForContext,
  isArtifactFeedback,
  normalizeArtifactFeedback,
} from "../src/artifacts/feedback.js";
import { ARTIFACT_SANDBOX, MAX_ARTIFACT_FEEDBACK_CHARS } from "../src/types/artifacts.js";

const fakeRuntime = { reactSource: "/* react */", sucraseSource: "/* sucrase */" };

describe("JSX/TSX artifact classification", () => {
  it("routes jsx and tsx to the react runtime", () => {
    expect(runtimeForLanguage("jsx")).toBe("react");
    expect(runtimeForLanguage("tsx")).toBe("react");
  });

  it("keeps html and svg on the plain html runtime", () => {
    expect(runtimeForLanguage("html")).toBe("html");
    expect(runtimeForLanguage("svg")).toBe("html");
  });

  it("classifies jsx fences as renderable", () => {
    const artifacts = extractArtifacts("```jsx\nfunction App(){ return <b>hi</b>; }\n```");
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]?.kind).toBe("render");
    expect(artifacts[0]?.runtime).toBe("react");
  });
});

describe("renderArtifactSrcdoc for react artifacts", () => {
  it("degrades to code-only when the runtime is absent", () => {
    const plan = renderArtifactSrcdoc({
      id: "artifact-0",
      index: 0,
      language: "jsx",
      code: "function App(){ return <b>hi</b>; }",
      kind: "render",
      runtime: "react",
    });
    expect(plan.kind).toBe("code");
    expect(plan.srcdoc).toBe("");
    expect(plan.reason).toBe("react-runtime-missing");
  });

  it("inlines the runtime, the harness and a mount point", () => {
    const plan = renderArtifactSrcdoc(
      {
        id: "artifact-2",
        index: 2,
        language: "jsx",
        code: "function App(){ return <b>hi</b>; }",
        kind: "render",
        runtime: "react",
      },
      { reactRuntime: fakeRuntime },
    );
    expect(plan.kind).toBe("render");
    expect(plan.runtime).toBe("react");
    expect(plan.srcdoc).toContain("/* react */");
    expect(plan.srcdoc).toContain("/* sucrase */");
    expect(plan.srcdoc).toContain('id="webos-root"');
    expect(plan.srcdoc).toContain("window.webos"); // harness present before the model's code runs
    expect(plan.srcdoc).toContain("__webosTransform");
  });

  it("never adds allow-same-origin to the sandbox attribute", () => {
    const plan = renderArtifactSrcdoc(
      {
        id: "artifact-0",
        index: 0,
        language: "jsx",
        code: "function App(){ return null; }",
        kind: "render",
        runtime: "react",
      },
      { reactRuntime: fakeRuntime },
    );
    expect(plan.sandbox).toBe(ARTIFACT_SANDBOX);
    expect(plan.sandbox).not.toContain("allow-same-origin");
  });

  it("escapes a literal closing script tag in model output", () => {
    // Without escaping, this would terminate the inline <script> early and the
    // rest of the model's code would be parsed as markup.
    const plan = renderArtifactSrcdoc(
      {
        id: "artifact-0",
        index: 0,
        language: "jsx",
        code: 'const x = "</script><img src=x onerror=alert(1)>";',
        kind: "render",
        runtime: "react",
      },
      { reactRuntime: fakeRuntime },
    );
    const closes = plan.srcdoc.match(/<\/script>/g) ?? [];
    expect(closes).toHaveLength(4); // runtime, sucrase, harness, bootstrap
    expect(plan.srcdoc).not.toContain("</script><img");
  });
});

describe("artifact feedback protocol", () => {
  it("exposes webos.report from the harness", () => {
    const script = artifactHarnessScript("artifact-1");
    expect(script).toContain("window.webos");
    expect(script).toContain("report");
    expect(script).toContain('"artifact-1"');
  });

  it("escapes the artifact id before inlining it", () => {
    // Defense in depth: ids are generated, but a malformed one must not be able
    // to break out of the script.
    expect(artifactHarnessScript('a";alert(1);//')).not.toContain('"a";alert(1);//"');
  });

  it("accepts a well-formed feedback payload", () => {
    const feedback = normalizeArtifactFeedback({
      artifactId: "artifact-0",
      label: "提交",
      payload: '{"total":42}',
      ts: 1,
    });
    expect(feedback).not.toBeNull();
    expect(feedback?.payload).toBe('{"total":42}');
    expect(isArtifactFeedback({ artifactId: "a", payload: "", ts: 1 })).toBe(true);
  });

  it("rejects malformed or missing fields", () => {
    expect(normalizeArtifactFeedback(null)).toBeNull();
    expect(normalizeArtifactFeedback("nope")).toBeNull();
    expect(normalizeArtifactFeedback({ payload: "x", ts: 1 })).toBeNull();
    expect(normalizeArtifactFeedback({ artifactId: "a", ts: 1 })).toBeNull();
    expect(normalizeArtifactFeedback({ artifactId: "", payload: "x", ts: 1 })).toBeNull();
  });

  it("caps an oversized payload instead of dropping it", () => {
    const feedback = normalizeArtifactFeedback({
      artifactId: "artifact-0",
      payload: "x".repeat(MAX_ARTIFACT_FEEDBACK_CHARS + 500),
      ts: 1,
    });
    expect(feedback?.payload).toHaveLength(MAX_ARTIFACT_FEEDBACK_CHARS);
  });

  it("formats feedback for injection into the next turn", () => {
    const text = formatFeedbackForContext({
      artifactId: "artifact-3",
      label: "计算",
      payload: "42",
      ts: 1,
    });
    expect(text).toContain("artifact-3");
    expect(text).toContain("计算");
    expect(text).toContain("42");
  });

  it("builds the message envelope the sandbox page listens for", () => {
    const message = buildFeedbackMessage({ artifactId: "artifact-0", payload: "v", ts: 7 });
    expect(message.type).toBe("webos.artifact.feedback");
    expect(message.payload.ts).toBe(7);
  });
});
