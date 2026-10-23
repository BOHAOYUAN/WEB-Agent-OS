/**
 * Pure selection + identity helpers for the artifact canvas.
 *
 * Both sides of the auto-render pipeline need to agree on two things:
 * which artifact is "the one" for a turn, and whether an artifact is the
 * same one as before (so a repeated push does not re-render a 435KB srcdoc).
 * Those decisions live here, dependency-free, so the service worker, the
 * side panel, and the tests all compute them identically.
 */

import type { Artifact } from "../types/artifacts.js";
import type { SensorEvent } from "../types/events.js";

/**
 * Pick the artifact a turn should auto-render: the LAST renderable one.
 *
 * "Renderable" is the artifact's own `kind` — set at extraction time from the
 * fence language. Note this deliberately ignores whether the React runtime
 * is injected: the caller renders through `renderArtifactSrcdoc`, which
 * downgrades a missing runtime to a code view. Selection and rendering are
 * separate concerns on purpose.
 */
export function selectAutoRenderArtifact(artifacts: readonly Artifact[]): Artifact | null {
  for (let index = artifacts.length - 1; index >= 0; index -= 1) {
    const artifact = artifacts[index];
    if (artifact && artifact.kind === "render") return artifact;
  }
  return null;
}

/** FNV-1a, 32-bit. Tiny, deterministic, no node/browser crypto split. */
function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/**
 * Stable identity for an artifact's CONTENT.
 *
 * Language + length + hash: two artifacts with the same signature are
 * treated as the same render. Collisions would only cause a skipped
 * re-render of visually identical content, which is the safe direction —
 * a false "different" would rebuild the iframe for nothing.
 */
export function artifactSignature(artifact: Artifact): string {
  return `${artifact.language || ""}:${artifact.code.length}:${fnv1a(artifact.code)}`;
}

/**
 * Whether a stream-end event means "the answer is complete enough to show".
 *
 * `finished` and `incomplete` both count: an incomplete stream (connection
 * dropped mid-answer) still produced the artifacts the user can see, and
 * hiding them would be worse than showing a partial answer. `aborted` (the
 * user pressed stop) and `error` do not.
 */
export function isTurnSettled(event: SensorEvent): boolean {
  if (event.type !== "sensor.stream.end") return false;
  return event.reason === "finished" || event.reason === "incomplete";
}
