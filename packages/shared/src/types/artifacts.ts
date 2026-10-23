/**
 * Artifact contract — a fenced code block extracted from a model answer that
 * can be either rendered in a sandboxed iframe (html/svg) or shown read-only.
 *
 * The render plan and its safety constants live here (pure types + values) so
 * the sandbox contract is testable in isolation from any DOM / network code.
 */

/** Whether an artifact is renderable in the sandbox or code-only. */
export type ArtifactRenderKind = "render" | "code";

/** Scope of the answer stream to extract artifacts from. */
export type ArtifactScope = "latest" | "all";

/**
 * How a renderable artifact must be executed inside the sandbox.
 *  - `html`: the code is markup, injected as-is (existing behaviour);
 *  - `react`: the code is JSX/TSX, transpiled then mounted with the vendored
 *    React runtime.
 */
export type ArtifactRuntime = "html" | "react";

/** Fence languages that need the React runtime. */
export const REACT_LANGUAGES: ReadonlySet<string> = new Set(["jsx", "tsx"]);

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
  /** render = html/htm/xhtml/svg/jsx/tsx; code = everything else. */
  kind: ArtifactRenderKind;
  /** Execution path for `render` artifacts; "html" for code-only ones. */
  runtime: ArtifactRuntime;
}

/**
 * Why an artifact was downgraded to code-only.
 *  - "unsupported-language": the fence language cannot be rendered;
 *  - "too-large": the code exceeded MAX_ARTIFACT_CHARS;
 *  - "react-runtime-missing": JSX/TSX, but the vendored runtime was not loaded.
 */
export type ArtifactRenderReason = "unsupported-language" | "too-large" | "react-runtime-missing";

/** Result of turning an artifact into an iframe srcdoc (or a downgrade). */
export interface ArtifactRenderPlan {
  /** Empty for `code` kind. */
  srcdoc: string;
  /** Always `"allow-scripts"` for `render`, empty for `code`. */
  sandbox: string;
  kind: ArtifactRenderKind;
  /** "html" for code-only plans; meaningful only when kind === "render". */
  runtime: ArtifactRuntime;
  /** True when the code exceeded the size cap and was downgraded. */
  truncated: boolean;
  /** `code` kind explanation; absent for `render` plans. */
  reason?: ArtifactRenderReason;
}

/**
 * Interaction feedback a rendered artifact sends back to the agent — the
 * "user clicked the button, here is the result" half of the loop.
 *
 * It travels iframe → sandbox page → service worker → `SystemContext`, so the
 * model can see what the user did with the component it generated. The payload
 * is a bounded string, never an object, so nothing structured has to be
 * trusted across the boundary.
 */
export interface ArtifactFeedback {
  /** Which artifact produced this. Derived from the artifact id, not model text. */
  artifactId: string;
  /** Short human label for the action (e.g. the button caption). */
  label?: string;
  /** Serialized result. Hard-capped; see MAX_ARTIFACT_FEEDBACK_CHARS. */
  payload: string;
  ts: number;
}

export const ARTIFACT_FEEDBACK_CHANNEL = "webos.artifact.feedback";

/** Hard cap on one feedback payload (anti-bloat on the injected context). */
export const MAX_ARTIFACT_FEEDBACK_CHARS = 4096;

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
 * CSP for fragment srcdocs. No network, no external resources, no nested
 * frames, no form submission, no top navigation. Complete documents are
 * returned intact and rely on the manifest sandbox page CSP instead.
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
