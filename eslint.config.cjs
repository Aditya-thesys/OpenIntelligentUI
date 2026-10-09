const eslint = require("@eslint/js");
const tseslint = require("@typescript-eslint/eslint-plugin");
const typescript = require("@typescript-eslint/parser");
const prettier = require("eslint-config-prettier");
const eslintPluginPrettier = require("eslint-plugin-prettier");
const reactHooks = require("eslint-plugin-react-hooks");
const unusedImports = require("eslint-plugin-unused-imports");

module.exports = [
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "**/*.config.ts",
      "local/**",
      "packages/core/src/host/generated.ts",
    ],
  },
  eslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      parser: typescript,
      parserOptions: { projectService: true, sourceType: "module" },
    },
    plugins: {
      "@typescript-eslint": tseslint,
      "unused-imports": unusedImports,
      prettier: eslintPluginPrettier,
    },
    rules: {
      ...tseslint.configs.recommended.rules,
      "no-undef": "off",
      "no-redeclare": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { vars: "all", varsIgnorePattern: "^_", args: "after-used", argsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-use-before-define": [
        "error",
        { functions: false, classes: false, variables: false },
      ],
      "unused-imports/no-unused-imports": "error",
      "no-console": ["error", { allow: ["error", "warn", "info"] }],
      ...eslintPluginPrettier.configs.recommended.rules,
    },
  },
  {
    files: ["packages/react/**/*.{ts,tsx}", "examples/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
    },
  },
  {
    files: ["**/*.{js,mjs,cjs}"],
    languageOptions: {
      globals: {
        URL: "readonly",
        console: "readonly",
        process: "readonly",
        require: "readonly",
        module: "writable",
        __dirname: "readonly",
      },
    },
  },
  prettier,
];
