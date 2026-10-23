import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  // The extension bundle defines `__DEV__` at build time (esbuild `define`).
  // Tests import the same sources directly, so the global must exist here too.
  define: { __DEV__: "true" },
  resolve: {
    alias: {
      "@webos/shared": r("./packages/shared/src/index.ts"),
      "@webos/router": r("./packages/router/src/index.ts"),
      "@webos/actor": r("./packages/actor/src/index.ts"),
      "@webos/ui": r("./packages/ui/src/index.ts"),
      "@webos/page-act": r("./packages/page-act/src/index.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["packages/**/test/**/*.test.ts", "apps/**/test/**/*.test.ts"],
    reporters: "default",
    // Serialize test files: vitest's shared-module transform cache is written
    // concurrently by workers, which trips a sandboxed-fs EPERM on Windows.
    fileParallelism: false,
  },
});
