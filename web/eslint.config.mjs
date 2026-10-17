import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // K8 (plan-k8 2.1): text is always text; no HTML from events, typed input or documents.
  { rules: { "react/no-danger": "error" } },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // K8 S1: the voice SDK's worklets, copied from node_modules (scripts/vendor-worklets.mjs).
    "public/vendor/**",
  ]),
]);

export default eslintConfig;
