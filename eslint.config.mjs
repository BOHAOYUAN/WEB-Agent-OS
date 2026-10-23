import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      "docs/captures/**",
      ".tmp-e2e/**",
      // Any local Chrome user-data directory (`--user-data-dir=.tmp-chrome-*`).
      // It holds tens of thousands of cache files; linting it hangs `verify`.
      ".tmp-chrome-*/**",
      ".tmp-test-*/**",
      ".local/**",
      // Build output: the vendored React/Sucrase bundles. They are minified
      // third-party code — linting them reports thousands of meaningless
      // errors (they used to live under dist/, which was already ignored).
      ".tmp-runtime/**",
      // Generated string constants (400 KB of inlined vendor code as TS
      // literals) — also produced by a build step, never hand-edited.
      "apps/extension/src/generated/**",
      ".workbuddy/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.ts"],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node, chrome: "readonly" },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "no-console": "off",
    },
  },
  {
    files: ["**/*.mjs"],
    languageOptions: { globals: { ...globals.node } },
  },
);
