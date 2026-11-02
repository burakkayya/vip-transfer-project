import { FlatCompat } from "@eslint/eslintrc";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const compat = new FlatCompat({ baseDirectory: __dirname });

const config = [
  { ignores: [".next", "e2e/.auth", "node_modules", "test-results", "playwright-report"] },
  ...compat.extends("next/core-web-vitals", "plugin:jsx-a11y/recommended"),
];

export default config;
