/**
 * Structural guards for the sidepanel shell. These are text assertions on the
 * source files (like manifest.test.ts), because the shell is DOM that only
 * exists inside a real Chrome side panel — there is no jsdom in this repo.
 */

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..", "..", "..");

const html = readFileSync(join(root, "apps/extension/src/sidepanel.html"), "utf8");
const css = readFileSync(join(root, "apps/extension/src/sidepanel.css"), "utf8");
const ts = readFileSync(join(root, "apps/extension/src/sidepanel.ts"), "utf8");

describe("sidepanel shell", () => {
  it("has both views behind tabs", () => {
    expect(html).toContain('data-view="console"');
    expect(html).toContain('data-view="canvas"');
    expect(html).toContain('id="console-view"');
    expect(html).toContain('id="canvas-view"');
    expect(html).toContain('id="canvas-root"');
  });

  it("still hosts the three console panels", () => {
    expect(html).toContain('id="actor-root"');
    expect(html).toContain('id="artifact-root"');
    expect(html).toContain('id="root"');
  });

  it("makes the console view scroll and the canvas view fill", () => {
    expect(css).toContain("#console-view");
    expect(css).toContain("#canvas-view");
    // Without full height + flex column the canvas cannot fill the panel.
    expect(css).toContain("height: 100%");
    expect(css).toContain("flex-direction: column");
  });

  it("has a pending-artifact dot on the canvas tab", () => {
    expect(html).toContain('id="canvas-dot"');
    expect(css).toContain(".view-tab-dot");
  });

  it("switches views with the hidden attribute, not by destroying them", () => {
    expect(ts).toContain("toggleAttribute(\"hidden\"");
  });
});

describe("regression guards", () => {
  it("never compares event.origin in the sidepanel — the sandbox iframe is opaque", () => {
    // An `event.origin === location.origin` check silently dropped EVERY
    // webos.report() message, because a sandboxed iframe's origin is "null".
    // Identity must come from event.source instead (see packages/ui/sandbox-frame).
    //
    // The guard matches COMPARISONS, not the bare word: comments legitimately
    // discuss `event.origin` to explain why it cannot be used, and a
    // contains-check would flag its own explanation (it did, once).
    expect(ts).not.toMatch(/event\.origin\s*(===|!==|==|!=)/);
    expect(ts).not.toMatch(/self\.location\.origin\s*(===|!==|==|!=)/);
  });

  it("never grants allow-same-origin to any artifact iframe in extension pages", () => {
    const pages = readdirSync(join(root, "apps/extension/src")).filter((file) => file.endsWith(".html"));
    expect(pages.length).toBeGreaterThan(0);
    for (const page of pages) {
      const source = readFileSync(join(root, "apps/extension/src", page), "utf8");
      expect(source).not.toContain("allow-same-origin");
    }
  });
});
