import { build, context } from "esbuild";
import { copyFile, mkdir, readFile, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildArtifactRuntime } from "./build-artifact-runtime.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const args = new Set(process.argv.slice(2));
const prod = args.has("--prod");
const watch = args.has("--watch");
const dist = join(root, "dist");

const alias = {
  "@webos/shared": join(root, "packages/shared/src/index.ts"),
  "@webos/router": join(root, "packages/router/src/index.ts"),
  "@webos/actor": join(root, "packages/actor/src/index.ts"),
  "@webos/ui": join(root, "packages/ui/src/index.ts"),
  "@webos/page-act": join(root, "packages/page-act/src/index.ts"),
};

const common = {
  bundle: true,
  target: ["chrome116"],
  platform: "browser",
  logLevel: "info",
  sourcemap: prod ? false : "inline",
  legalComments: "none",
  define: { __DEV__: JSON.stringify(!prod) },
  alias,
  absWorkingDir: root,
};

// Browser bundles (extension pages / injected worlds).
// `split: true` enables esbuild code splitting for that entry: the side panel
// lazy-imports the vendored artifact runtime, which then lands in its own
// chunk instead of bloating the panel's main bundle.
const browserEntries = [
  { entry: "packages/sensor/src/main/index.ts", outfile: "sensor-main.js", format: "iife" },
  { entry: "packages/sensor/src/bridge/index.ts", outfile: "sensor-bridge.js", format: "iife" },
  { entry: "apps/extension/src/pageact-content.ts", outfile: "pageact-content.js", format: "iife" },
  { entry: "apps/extension/src/background.ts", outfile: "background.js", format: "esm" },
  { entry: "apps/extension/src/sidepanel.ts", split: true, format: "esm" },
];

// The Actor bridge CLI is a Node binary, not a browser bundle.
const nodeCommon = { ...common, platform: "node", target: ["node22"] };
const nodeEntries = [{ entry: "packages/actor/src/cli.ts", outfile: "actor-cli.js", format: "esm" }];

async function copyStatic() {
  const manifest = prod ? "apps/extension/manifest.json" : "apps/extension/manifest.dev.json";
  await copyFile(join(root, manifest), join(dist, "manifest.json"));
  await copyFile(join(root, "apps/extension/src/sidepanel.html"), join(dist, "sidepanel.html"));
  await copyFile(join(root, "apps/extension/src/sidepanel.css"), join(dist, "sidepanel.css"));
  await copyFile(join(root, "apps/extension/src/artifact-sandbox.html"), join(dist, "artifact-sandbox.html"));

  const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  const manifestJson = JSON.parse(await readFile(join(dist, "manifest.json"), "utf8"));
  if (pkg.version !== manifestJson.version) {
    throw new Error("package.json version and manifest version differ: " + pkg.version + " vs " + manifestJson.version);
  }
}

const browserConfigs = browserEntries.map((item) => {
  if (item.split) {
    return {
      ...common,
      entryPoints: [item.entry],
      // Code splitting requires an output directory (outfile is rejected) and
      // rejects inline source maps — dev builds emit linked maps beside the
      // chunks, which debug identically for an unpacked extension.
      outdir: dist,
      format: item.format,
      splitting: true,
      sourcemap: prod ? false : "linked",
    };
  }
  return {
    ...common,
    entryPoints: [item.entry],
    outfile: join(dist, item.outfile),
    format: item.format,
  };
});
const nodeConfigs = nodeEntries.map((item) => ({
  ...nodeCommon,
  entryPoints: [item.entry],
  outfile: join(dist, item.outfile),
  format: item.format,
}));

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
// After the clean: the vendored Artifacts runtime must be generated before the
// browser bundles that import its string form. The standalone IIFE bundles go
// to .tmp-runtime/ (scratch) — dist/ is the extension package and nothing in
// it loads those files.
await buildArtifactRuntime({ watch: false });

if (watch) {
  const contexts = await Promise.all([...browserConfigs, ...nodeConfigs].map((cfg) => context(cfg)));
  await Promise.all(contexts.map((ctx) => ctx.watch()));
  await copyStatic();
  console.log("[build] watching; dist = " + dist);
} else {
  await Promise.all([...browserConfigs, ...nodeConfigs].map((cfg) => build(cfg)));
  await copyStatic();
  console.log("[build] done; dist = " + dist + (prod ? " (prod)" : " (dev)"));
}
