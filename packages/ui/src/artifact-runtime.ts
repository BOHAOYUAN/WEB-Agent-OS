/**
 * Vendored runtime for JSX artifacts, injected at startup.
 *
 * The UI package must not import build output, so the extension hands the two
 * bundle sources in via `setArtifactRuntime`. If it never does, JSX artifacts
 * degrade to read-only code instead of rendering a blank frame — a missing
 * runtime is a missing feature, not a security hole.
 */

import type { ArtifactRenderOptions } from "@webos/shared";

export type ReactRuntime = NonNullable<ArtifactRenderOptions["reactRuntime"]>;

let current: ReactRuntime | undefined;

export function setArtifactRuntime(reactSource: string, sucraseSource: string): void {
  current = { reactSource, sucraseSource };
}

export function getArtifactRuntime(): ReactRuntime | undefined {
  return current;
}

/** Test seam / teardown. */
export function clearArtifactRuntime(): void {
  current = undefined;
}
