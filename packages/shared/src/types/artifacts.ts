/**
 * Artifact contract — a fenced code block extracted from a model answer that
 * can be either rendered in a sandboxed iframe (html/svg) or shown read-only.
 *
 * The render plan and its safety constants live here (pure types + values) so
 * the sandbox contract is testable in isolation from any DOM / network code.
 */

/** Whether an artifact is renderable in the sandbox or code-only. */
export type ArtifactRenderKind = "render" | "code";

/** A single fenced code block extracted from an answer stream. */
export interface Artifact {
  /** Stable id derived from the index only — never contains user input. */
  id: string;
  /** 0-based position in the answer (list key + open targeting). */
  index: number;
  /** Normalized fence language (lowercased, trimmed); "" when absent. */
  language: string;
  /** Code content, fence delimiters stripped. */
  code: string;
  /** render = html/htm/xhtml/svg; code = everything else. */
  kind: ArtifactRenderKind;
}

/** Result of turning an artifact into an iframe srcdoc (or a downgrade). */
export interface ArtifactRenderPlan {
  /** Empty for `code` kind. */
  srcdoc: string;
  /** Always `"allow-scripts"` for `render`, empty for `code`. */
  sandbox: string;
  kind: ArtifactRenderKind;
  /** True when the code exceeded the size cap and was downgraded. */
  truncated: boolean;
  /** `code` kind explanation: "unsupported-language" | "too-large". */
  reason?: string;
}

/** Hard cap on a single artifact's code size (anti-bloat / anti-DoS). */
export const MAX_ARTIFACT_CHARS = 256 * 1024;

/**
 * iframe sandbox attribute. MUST remain a single token: `allow-scripts`.
 * `allow-same-origin` must NEVER be added — it would give the iframe the
 * extension's origin and let model output reach privileged extension APIs,
 * storage, or the bridge token.
 */
export const ARTIFACT_SANDBOX = "allow-scripts";

/**
 * CSP injected into the srcdoc. No network, no external resources, no nested
 * frames, no form submission, no top navigation. Inline script/style are the
 * only things allowed (model output is inline by construction).
 */
export const ARTIFACT_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  "img-src data:",
  "connect-src 'none'",
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");
