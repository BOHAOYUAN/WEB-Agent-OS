import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

describe("Artifacts sandbox manifest contract", () => {
  for (const file of ["manifest.json", "manifest.dev.json"]) {
    it(file + " declares the sandbox page and a network-blocking CSP", () => {
      const manifest = JSON.parse(readFileSync(join(root, "apps/extension", file), "utf8")) as {
        sandbox?: { pages?: string[] };
        content_security_policy?: { sandbox?: string };
      };
      expect(manifest.sandbox?.pages).toContain("artifact-sandbox.html");
      const csp = manifest.content_security_policy?.sandbox ?? "";
      expect(csp).toContain("sandbox allow-scripts");
      expect(csp).toContain("script-src 'unsafe-inline'");
      expect(csp).toContain("connect-src 'none'");
      expect(csp).toContain("default-src 'none'");
    });
  }

  it("the sandbox page only accepts parent messages and writes into a nested iframe", () => {
    const html = readFileSync(join(root, "apps/extension/src/artifact-sandbox.html"), "utf8");
    // Render instructions come from the sidepanel, and only from it.
    expect(html).toContain("event.source === window.parent");
    expect(html).toContain("data.type !== \"webos/artifact.render\"");
    expect(html).toContain("target.srcdoc = data.html");
  });

  it("the sandbox page verifies artifact feedback came from its own iframe", () => {
    const html = readFileSync(join(root, "apps/extension/src/artifact-sandbox.html"), "utf8");
    // The artifact iframe has an opaque origin, so event.origin is "null" and
    // cannot be checked — source identity is the only guard available.
    expect(html).toContain("event.source === target.contentWindow");
    expect(html).toContain("webos.artifact.feedback");
  });

  it("the sandbox page never grants allow-same-origin to the artifact iframe", () => {
    const html = readFileSync(join(root, "apps/extension/src/artifact-sandbox.html"), "utf8");
    const sandboxAttr = /<iframe[^>]*sandbox="([^"]*)"/.exec(html)?.[1] ?? "";
    expect(sandboxAttr).toBe("allow-scripts");
    expect(sandboxAttr).not.toContain("allow-same-origin");
  });
});
