import { readdir, readFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const problems = [];
const warnings = [];

const allowedDependencies = {
  shared: [],
  sensor: ["@webos/shared"],
  router: ["@webos/shared"],
  actor: ["@webos/shared"],
  ui: ["@webos/shared"],
  brain: ["@webos/shared"],
  "page-act": ["@webos/shared"],
};

const forbidden = [
  {
    dir: "packages/shared/src",
    patterns: ["document.cookie", "localStorage", "sessionStorage", "chrome.", "getAllResponseHeaders", "Authorization"],
    why: "shared must stay platform-agnostic and must never touch credentials",
  },
  {
    dir: "packages/sensor/src",
    patterns: ["document.cookie", "localStorage", "sessionStorage", "getAllResponseHeaders", "getRequestHeader", "Authorization", "x-ds-pow-response", "x-hif-"],
    why: "the sensor must never read credentials or anti-bot headers",
  },
  {
    dir: "packages/sensor/src/main/taps",
    patterns: ["setRequestHeader", "getResponseHeader", ".headers", "credentials"],
    why: "injection may only rewrite the request body, never touch request headers or credentials",
  },
  {
    dir: "apps/extension/src",
    patterns: ["fetch(", "XMLHttpRequest", "WebSocket", "document.cookie", "localStorage"],
    why: "service worker and side panel must not perform network I/O or read credentials",
    // The one sanctioned exception: actor-client.ts opens a WebSocket to the
    // LOCAL Actor bridge on 127.0.0.1 only. It is excluded from this broad scan
    // and held to a stricter host contract by a dedicated check below.
    exclude: ["actor-client.ts"],
  },
  {
    dir: "packages/ui/src",
    patterns: ["fetch(", "XMLHttpRequest", "WebSocket", "document.cookie", "localStorage"],
    why: "the debug UI is render-only",
  },
  {
    dir: "packages/page-act/src",
    patterns: ["fetch(", "XMLHttpRequest", "WebSocket", "document.cookie", "localStorage"],
    why: "the page-act layer drives the DOM; it never touches the network or storage",
  },
];

async function walk(dir) {
  const out = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full)));
    else if (entry.name.endsWith(".ts")) out.push(full);
  }
  return out;
}

function importsOf(source) {
  const specifiers = [];
  const pattern = /(?:from\s+|import\s*\(\s*)["']([^"']+)["']/g;
  for (const match of source.matchAll(pattern)) {
    if (match[1]) specifiers.push(match[1]);
  }
  return specifiers;
}

for (const [pkg, allowed] of Object.entries(allowedDependencies)) {
  const src = join(root, "packages", pkg, "src");
  for (const file of await walk(src)) {
    const source = await readFile(file, "utf8");
    for (const specifier of importsOf(source)) {
      if (!specifier.startsWith("@webos/")) continue;
      if (!allowed.includes(specifier)) {
        problems.push(relative(root, file) + ": " + pkg + " may not import " + specifier);
      }
    }
    if (source.split("\n").length > 350) {
      warnings.push(relative(root, file) + ": " + source.split("\n").length + " lines (>350), consider splitting");
    }
  }
}

for (const rule of forbidden) {
  for (const file of await walk(join(root, rule.dir))) {
    if (rule.exclude?.some((name) => file.endsWith(name))) continue;
    const source = await readFile(file, "utf8");
    for (const pattern of rule.patterns) {
      if (source.includes(pattern)) {
        problems.push(relative(root, file) + ": forbidden token '" + pattern + "' — " + rule.why);
      }
    }
  }
}

// actor-client.ts is the sole sanctioned WebSocket user. Hold it to a stricter
// contract: it may only dial 127.0.0.1 and must never log the token.
{
  const actorClient = join(root, "apps", "extension", "src", "actor-client.ts");
  let source = "";
  try {
    source = await readFile(actorClient, "utf8");
  } catch {
    source = "";
  }
  if (source) {
    for (const match of source.matchAll(/wss?:\/\/([0-9a-zA-Z.-]+)/g)) {
      const host = match[1];
      if (host !== "127.0.0.1") {
        problems.push(
          relative(root, actorClient) + ": actor-client dials non-local host '" + host + "' — must be 127.0.0.1 only",
        );
      }
    }
    if (/console\.(?:log|debug|info|warn|error)\([^)]*token/i.test(source)) {
      problems.push(relative(root, actorClient) + ": actor-client must never log the token");
    }
  }
}

if (warnings.length > 0) {
  console.log("[arch] warnings:");
  for (const warning of warnings) console.log("  - " + warning);
}

if (problems.length > 0) {
  console.error("[arch] violations:");
  for (const problem of problems) console.error("  - " + problem);
  process.exitCode = 1;
} else {
  console.log("[arch] ok: module boundaries and red-line scans passed");
}
