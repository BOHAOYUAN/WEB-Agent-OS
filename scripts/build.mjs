import { build, context } from "esbuild";
import { copyFile, mkdir, readFile, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

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

const entries = [
  { entry: "packages/sensor/src/main/index.ts", outfile: "sensor-main.js", format: "iife" },
  { entry: "packages/sensor/src/bridge/index.ts", outfile: "sensor-bridge.js", format: "iife" },
  { entry: "apps/extension/src/background.ts", outfile: "background.js", format: "esm" },
  { entry: "apps/extension/src/sidepanel.ts", outfile: "sidepanel.js", format: "esm" },
];

async function copyStatic() {
  const manifest = prod ? "apps/extension/manifest.json" : "apps/extension/manifest.dev.json";
  await copyFile(join(root, manifest), join(dist, "manifest.json"));
  await copyFile(join(root, "apps/extension/src/sidepanel.html"), join(dist, "sidepanel.html"));
  await copyFile(join(root, "apps/extension/src/sidepanel.css"), join(dist, "sidepanel.css"));

  const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  const manifestJson = JSON.parse(await readFile(join(dist, "manifest.json"), "utf8"));
  if (pkg.version !== manifestJson.version) {
    throw new Error("package.json version and manifest version differ: " + pkg.version + " vs " + manifestJson.version);
  }
}

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

if (watch) {
  const contexts = await Promise.all(
    entries.map((item) =>
      context({ ...common, entryPoints: [item.entry], outfile: join(dist, item.outfile), format: item.format }),
    ),
  );
  await Promise.all(contexts.map((ctx) => ctx.watch()));
  await copyStatic();
  console.log("[build] watching; dist = " + dist);
} else {
  await Promise.all(
    entries.map((item) =>
      build({ ...common, entryPoints: [item.entry], outfile: join(dist, item.outfile), format: item.format }),
    ),
  );
  await copyStatic();
  console.log("[build] done; dist = " + dist + (prod ? " (prod)" : " (dev)"));
}
