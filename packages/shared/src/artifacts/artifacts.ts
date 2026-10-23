/**
 * Artifact extraction + sandbox rendering. Pure functions only — no DOM, no
 * I/O — so the whole sandbox contract is unit-testable in node.
 *
 * The security model is layered:
 *   1. `renderArtifactSrcdoc` only ever emits `sandbox = "allow-scripts"` and
 *      never `allow-same-origin` (opaque origin, no extension access).
 *   2. Fragments carry a meta CSP that forbids network; complete documents are
 *      returned intact and rely on the manifest sandbox page CSP.
 *   3. Only html/htm/xhtml/svg are renderable; everything else is code-only.
 *   4. Nothing here executes anything — these are string builders. WHO
 *      initiates a render (user click vs. auto-render after a settled turn) is
 *      a UX decision made by the caller; the security boundary is the sandbox
 *      isolation above, never the click. Auto-render is off-by-toggle and the
 *      canvas states in its UI that model code runs in a sandbox.
 */

import type { SensorEvent } from "../types/events.js";
import type {
  Artifact,
  ArtifactRenderKind,
  ArtifactRenderPlan,
  ArtifactRuntime,
  ArtifactScope,
} from "../types/artifacts.js";
import { ARTIFACT_CSP, ARTIFACT_SANDBOX, MAX_ARTIFACT_CHARS, REACT_LANGUAGES } from "../types/artifacts.js";
import { artifactHarnessScript } from "./feedback.js";

/** Languages that may be rendered inside the sandboxed iframe. */
const RENDERABLE_LANGUAGES: ReadonlySet<string> = new Set(["html", "htm", "xhtml", "svg", "jsx", "tsx"]);

/** Fence info line: optional leading/trailing horizontal whitespace, language. */
const FENCE_RE = /```[^\S\r\n]*([a-zA-Z0-9_+#-]*)[^\S\r\n]*\r?\n([\s\S]*?)(?:\r?\n)?```/g;

function normalizeLanguage(raw: string): string {
  return raw.trim().toLowerCase();
}

/**
 * Aggregate the answer channel text in stream order, ignoring thinking deltas.
 * Not trimmed, not regrouped by requestId — the answer stream is already ordered.
 *
 * `scope` controls which turns are included:
 *  - `"all"`: every answer delta in the stream (default, backward compatible);
 *  - `"latest"`: only the most recent turn (the last requestId to emit an
 *    answer delta) — used so a fresh "读取 Artifacts" shows just the last answer.
 */
export function buildAnswerText(events: SensorEvent[], scope: ArtifactScope = "all"): string {
  if (scope === "latest") {
    let latestRequestId: string | null = null;
    for (const event of events) {
      if (event.type === "sensor.text.delta" && event.channel === "answer") {
        latestRequestId = event.requestId;
      }
    }
    if (latestRequestId === null) return "";
    let text = "";
    for (const event of events) {
      if (event.type === "sensor.text.delta" && event.channel === "answer" && event.requestId === latestRequestId) {
        text += event.text;
      }
    }
    return text;
  }

  let text = "";
  for (const event of events) {
    if (event.type === "sensor.text.delta" && event.channel === "answer") {
      text += event.text;
    }
  }
  return text;
}

/** Classify a fence language as renderable or code-only. */
export function classifyLanguage(language: string): ArtifactRenderKind {
  return RENDERABLE_LANGUAGES.has(normalizeLanguage(language)) ? "render" : "code";
}

/** Which runtime a renderable artifact needs. Code-only artifacts say "html". */
export function runtimeForLanguage(language: string): ArtifactRuntime {
  return REACT_LANGUAGES.has(normalizeLanguage(language)) ? "react" : "html";
}

/**
 * Extract closed fenced code blocks from a full answer text.
 *
 * The regex is non-greedy up to the first closing fence, so an unclosed trailing
 * fence is naturally skipped (no closing ``` to pair with). `id` is derived from
 * the index only — never from model output.
 */
export function extractArtifacts(text: string): Artifact[] {
  const artifacts: Artifact[] = [];
  let index = 0;
  FENCE_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = FENCE_RE.exec(text)) !== null) {
    const language = normalizeLanguage(match[1] ?? "");
    const code = match[2] ?? "";
    artifacts.push({
      id: `artifact-${index}`,
      index,
      language,
      code,
      kind: classifyLanguage(language),
      runtime: runtimeForLanguage(language),
    });
    index += 1;
  }
  return artifacts;
}

/**
 * Extract model-proposed page actions from an answer.
 *
 * The trigger is a fenced block whose info string is `pageact`, containing a
 * JSON array of `PageAction`s. It rides the exact same fence pipeline as
 * artifacts — no new surface, no new regex — so a malformed block is skipped
 * here and strict shape validation happens later in `@webos/page-act`.
 *
 * The payload is returned UNVALIDATED: this function only does "is it a
 * `pageact` fence with JSON inside". The host (`validatePageActions`) is the
 * single enforcement point, shared with the manual console path.
 */
export function extractPageActions(text: string): { actions: unknown }[] {
  const requests: { actions: unknown }[] = [];
  for (const artifact of extractArtifacts(text)) {
    if (artifact.language !== "pageact") continue;
    try {
      requests.push({ actions: JSON.parse(artifact.code) as unknown });
    } catch {
      // Model JSON is unreliable. A block that does not parse is ignored —
      // it is not worth a UI round trip that the host would refuse anyway.
    }
  }
  return requests;
}

/**
 * Build the iframe srcdoc for a renderable artifact, or downgrade to code-only.
 *
 * Red lines (unit-tested): the sandbox is always exactly `ARTIFACT_SANDBOX`
 * (never `allow-same-origin`), and the CSP forbids network. Oversized artifacts
 * are downgraded rather than rendered.
 */
export interface ArtifactRenderOptions {
  /**
   * Source text of the vendored React + Sucrase bundles. Required to render
   * `react` artifacts — they are INLINED into the srcdoc rather than loaded
   * via `<script src>`, because a srcdoc iframe has an opaque origin, where
   * CSP `'self'` matches nothing and extension resources are unreachable.
   *
   * When absent, JSX/TSX artifacts degrade to code-only instead of rendering
   * a blank frame.
   */
  reactRuntime?: { reactSource: string; sucraseSource: string };
}

export function renderArtifactSrcdoc(
  artifact: Artifact,
  options: ArtifactRenderOptions = {},
): ArtifactRenderPlan {
  if (artifact.kind !== "render") {
    return {
      srcdoc: "",
      sandbox: "",
      kind: "code",
      runtime: artifact.runtime,
      truncated: false,
      reason: "unsupported-language",
    };
  }
  if (artifact.code.length > MAX_ARTIFACT_CHARS) {
    return {
      srcdoc: "",
      sandbox: "",
      kind: "code",
      runtime: artifact.runtime,
      truncated: true,
      reason: "too-large",
    };
  }

  if (artifact.runtime === "react") {
    if (!options.reactRuntime) {
      return {
        srcdoc: "",
        sandbox: "",
        kind: "code",
        runtime: artifact.runtime,
        truncated: false,
        reason: "react-runtime-missing",
      };
    }
    return {
      srcdoc: buildReactSrcdoc(artifact, options.reactRuntime),
      sandbox: ARTIFACT_SANDBOX,
      kind: "render",
      runtime: "react",
      truncated: false,
    };
  }

  // A model can return either a fragment or a complete document. Wrapping a
  // complete document in another <body> makes the parser treat its <style>/
  // <script> as text, so keep full documents intact. The manifest sandbox page
  // supplies the network-blocking CSP for this case; fragments also carry the
  // meta CSP below as defense in depth.
  if (/<!doctype|<html[\s>]/i.test(artifact.code)) {
    return { srcdoc: artifact.code, sandbox: ARTIFACT_SANDBOX, kind: "render", runtime: "html", truncated: false };
  }
  const srcdoc = [
    '<!doctype html><html><head><meta charset="utf-8">',
    `<meta http-equiv="Content-Security-Policy" content="${ARTIFACT_CSP}">`,
    "</head><body>",
    artifact.code,
    "</body></html>",
  ].join("");
  return { srcdoc, sandbox: ARTIFACT_SANDBOX, kind: "render", runtime: "html", truncated: false };
}

/**
 * Escape a string for inlining inside a `<script>` element. `JSON.stringify`
 * alone is not enough: a literal `</script>` in model output would close the
 * tag early and let the rest of the code out into markup.
 */
function inlineScriptString(value: string): string {
  return JSON.stringify(value).replace(/<\/(script)/gi, "<\\/$1");
}

/** Build the srcdoc that transpiles and mounts a JSX/TSX artifact. */
function buildReactSrcdoc(
  artifact: Artifact,
  runtime: { reactSource: string; sucraseSource: string },
): string {
  const bootstrap = [
    "(function () {",
    "  var host = document.getElementById('webos-root');",
    "  function fail(message) {",
    "    host.textContent = '';",
    "    var pre = document.createElement('pre');",
    "    pre.style.cssText = 'color:#b91c1c;font:12px/1.5 ui-monospace,monospace;white-space:pre-wrap';",
    "    pre.textContent = message;",
    "    host.appendChild(pre);",
    "  }",
    "  try {",
    `    var compiled = window.__webosTransform(${inlineScriptString(artifact.code)});`,
    "    var runner = document.createElement('script');",
    "    runner.textContent = compiled +",
    "      '\\n;if (typeof App !== \"undefined\") {' +",
    "      ' ReactDOM.createRoot(document.getElementById(\"webos-root\")).render(React.createElement(App));' +",
    "      '} else { throw new Error(\"没有找到 App 组件：请导出一个名为 App 的组件\"); }';",
    "    document.body.appendChild(runner);",
    "  } catch (error) {",
    "    fail('渲染失败：' + (error && error.message ? error.message : String(error)));",
    "  }",
    "})();",
  ].join("\n");

  return [
    '<!doctype html><html><head><meta charset="utf-8">',
    `<meta http-equiv="Content-Security-Policy" content="${ARTIFACT_CSP}">`,
    "</head><body>",
    '<div id="webos-root"></div>',
    // Runtime first, then the harness, so `webos.report` exists before the
    // model's code runs. Both are inlined — see ArtifactRenderOptions.
    `<script>${runtime.reactSource}</script>`,
    `<script>${runtime.sucraseSource}</script>`,
    `<script>${artifactHarnessScript(artifact.id)}</script>`,
    `<script>${bootstrap}</script>`,
    "</body></html>",
  ].join("");
}
