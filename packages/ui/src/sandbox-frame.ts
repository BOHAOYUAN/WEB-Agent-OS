/**
 * The artifact sandbox iframe, plus the only correct way to read messages from
 * it.
 *
 * Why this file exists: the iframe is created with `sandbox="allow-scripts"`
 * and deliberately WITHOUT `allow-same-origin`, so it has an **opaque origin**
 * and `event.origin` is always the literal string `"null"`. An
 * `event.origin === location.origin` check therefore rejects every single
 * message — which is exactly the bug that silently killed the feedback channel.
 *
 * Under an opaque origin there is only one trustworthy identity signal:
 * `event.source`, which is the sender's WindowProxy and can be compared
 * directly against `iframe.contentWindow`. That comparison can only be made by
 * whoever holds the iframe, so creating the iframe and listening for its
 * messages must live in the same closure — hence this factory.
 */

import { ARTIFACT_FEEDBACK_CHANNEL, normalizeArtifactFeedback } from "@webos/shared";
import type { ArtifactFeedback } from "@webos/shared";

/** Minimal shape of a message event, so the pure function is testable in node. */
interface FeedbackEventLike {
  source: unknown;
  data: unknown;
}

/**
 * Validate one postMessage as artifact feedback.
 *
 * Three gates, in order: identity (`event.source` matches the trusted window),
 * channel (the agreed message type), then shape + length caps.
 * Returns null for anything that fails — cross-frame input is never trusted.
 */
export function readSandboxFeedback(
  event: FeedbackEventLike,
  trusted: Window | null,
): ArtifactFeedback | null {
  // 1. Identity. Before the iframe has loaded, `trusted` is null and nothing
  //    is accepted — an about:blank frame must not be able to talk to us.
  if (!trusted || event.source !== trusted) return null;

  const data = event.data as { type?: unknown; payload?: unknown } | null;
  if (!data || typeof data !== "object") return null;

  // 2. Channel.
  if (data.type !== ARTIFACT_FEEDBACK_CHANNEL) return null;

  // 3. Shape + bounds.
  return normalizeArtifactFeedback(data.payload);
}

export interface SandboxFrame {
  readonly element: HTMLIFrameElement;
  /** Send a srcdoc for the nested frame to render. Safe before load. */
  render(html: string): void;
  dispose(): void;
}

export interface SandboxFrameOptions {
  /** Always `"allow-scripts"` — never with `allow-same-origin`. */
  sandbox: string;
  /** Page that hosts the nested srcdoc iframe. */
  src: string;
  onFeedback: (feedback: ArtifactFeedback) => void;
  /** CSS class for the iframe; the canvas passes its own to size it full-height. */
  className?: string;
}

export function createSandboxFrame(options: SandboxFrameOptions): SandboxFrame {
  const iframe = document.createElement("iframe");
  iframe.className = options.className ?? "artifact-iframe";
  // The single most important line in this file: the sandbox attribute must
  // stay a single token so the frame keeps an opaque origin with no access to
  // extension APIs, storage, or the bridge token.
  iframe.setAttribute("sandbox", options.sandbox);
  iframe.src = options.src;

  let trusted: Window | null = null;
  let pending: string | null = null;

  const flush = (): void => {
    if (!trusted || pending === null) return;
    // Opaque origins cannot be named in targetOrigin, so "*" is the only
    // option. Confidentiality is not at stake here (we are sending to our own
    // sandbox page) and identity is enforced by the `event.source` gate above.
    trusted.postMessage({ type: "webos/artifact.render", html: pending }, "*");
    pending = null;
  };

  const onLoad = (): void => {
    trusted = iframe.contentWindow;
    flush();
  };
  const onMessage = (event: MessageEvent): void => {
    const feedback = readSandboxFeedback(event, trusted);
    if (feedback) options.onFeedback(feedback);
  };

  iframe.addEventListener("load", onLoad);
  window.addEventListener("message", onMessage);

  return {
    element: iframe,
    render(html: string): void {
      pending = html;
      flush();
    },
    dispose(): void {
      window.removeEventListener("message", onMessage);
      iframe.removeEventListener("load", onLoad);
      trusted = null;
      pending = null;
      iframe.remove();
    },
  };
}
