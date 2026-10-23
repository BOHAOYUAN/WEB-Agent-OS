/**
 * Guards for how the side panel bundle is composed.
 *
 * The vendored artifact runtime is ~420 KB of string constants (React 19 +
 * Sucrase, kept as source text because a srcdoc iframe has an opaque origin
 * and cannot load extension resources).
 *
 * Imported statically, all of it lands in the panel's main chunk — measured
 * 1.2 MB. Imported dynamically, esbuild splits it into a lazy chunk: 54 KB
 * main + 418 KB fetched on demand. Nothing about the runtime's content
 * changed, only when it is loaded, and the CSP stayed exactly as it was.
 *
 * These are text assertions on two files that no unit test imports: the
 * property being guarded is a build-time one, and the failure mode is
 * silent (the bundle just gets big again).
 */

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..", "..", "..");

const sidepanel = readFileSync(join(root, "apps/extension/src/sidepanel.ts"), "utf8");
const buildScript = readFileSync(join(root, "scripts/build.mjs"), "utf8");
const runtimeScript = readFileSync(join(root, "scripts/build-artifact-runtime.mjs"), "utf8");

describe("sidepanel bundle composition", () => {
  it("lazy-imports the vendored runtime instead of inlining it", () => {
    // A static import puts the whole runtime into the main chunk.
    expect(sidepanel).not.toMatch(
      /import\s+\{[^}]*\}\s+from\s+"\.\/generated\/artifact-runtime\.js"/,
    );
    // A dynamic import lets esbuild emit it as a separate chunk.
    expect(sidepanel).toMatch(/import\("\.\/generated\/artifact-runtime\.js"\)/);
  });

  it("keeps a failed runtime load non-fatal", () => {
    // A rejected chunk load must degrade to read-only code, not raise an
    // unhandled rejection inside the panel.
    expect(sidepanel).toMatch(/\.catch\(\(\) => undefined\)/);
  });

  it("builds the side panel with code splitting enabled", () => {
    expect(buildScript).toContain("splitting: true");
    // ...and it is the side panel entry that is split.
    expect(buildScript).toMatch(/sidepanel\.ts[^\n]*split: true/);
  });

  it("keeps the standalone runtime bundles out of the extension package", () => {
    // dist/ IS the extension package. Nothing in the extension loads these two
    // files — only the E2E script reads them as source text — so shipping them
    // duplicated the runtime (427 KB of dead weight).
    expect(runtimeScript).toContain(".tmp-runtime");
    expect(runtimeScript).not.toMatch(/join\(root,\s*"dist"\)/);
  });
});
