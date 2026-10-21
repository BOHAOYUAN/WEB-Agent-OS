import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@webos/shared": r("./packages/shared/src/index.ts"),
      "@webos/router": r("./packages/router/src/index.ts"),
      "@webos/actor": r("./packages/actor/src/index.ts"),
      "@webos/ui": r("./packages/ui/src/index.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["packages/**/test/**/*.test.ts", "apps/**/test/**/*.test.ts"],
    reporters: "default",
  },
});
