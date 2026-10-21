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
 *   4. The UI must render on explicit user action; nothing here auto-executes.
 */

import type { SensorEvent } from "../types/events.js";
import type { Artifact, ArtifactRenderKind, ArtifactRenderPlan, ArtifactScope } from "../types/artifacts.js";
import { ARTIFACT_CSP, ARTIFACT_SANDBOX, MAX_ARTIFACT_CHARS } from "../types/artifacts.js";

/** Languages that may be rendered inside the sandboxed iframe. */
const RENDERABLE_LANGUAGES: ReadonlySet<string> = new Set(["html", "htm", "xhtml", "svg"]);

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
    });
    index += 1;
  }
  return artifacts;
}

/**
 * Build the iframe srcdoc for a renderable artifact, or downgrade to code-only.
 *
 * Red lines (unit-tested): the sandbox is always exactly `ARTIFACT_SANDBOX`
 * (never `allow-same-origin`), and the CSP forbids network. Oversized artifacts
 * are downgraded rather than rendered.
 */
export function renderArtifactSrcdoc(artifact: Artifact): ArtifactRenderPlan {
  if (artifact.kind !== "render") {
    return { srcdoc: "", sandbox: "", kind: "code", truncated: false, reason: "unsupported-language" };
  }
  if (artifact.code.length > MAX_ARTIFACT_CHARS) {
    return { srcdoc: "", sandbox: "", kind: "code", truncated: true, reason: "too-large" };
  }
  // A model can return either a fragment or a complete document. Wrapping a
  // complete document in another <body> makes the parser treat its <style>/
  // <script> as text, so keep full documents intact. The manifest sandbox page
  // supplies the network-blocking CSP for this case; fragments also carry the
  // meta CSP below as defense in depth.
  if (/<!doctype|<html[\s>]/i.test(artifact.code)) {
    return { srcdoc: artifact.code, sandbox: ARTIFACT_SANDBOX, kind: "render", truncated: false };
  }
  const srcdoc = [
    '<!doctype html><html><head><meta charset="utf-8">',
    `<meta http-equiv="Content-Security-Policy" content="${ARTIFACT_CSP}">`,
    "</head><body>",
    artifact.code,
    "</body></html>",
  ].join("");
  return { srcdoc, sandbox: ARTIFACT_SANDBOX, kind: "render", truncated: false };
}
