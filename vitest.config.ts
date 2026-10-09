import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const src = (path: string) => fileURLToPath(new URL(`./packages/${path}`, import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      {
        find: "@open-intelligent-ui/core/compiler",
        replacement: src("core/src/compiler/index.ts"),
      },
      { find: "@open-intelligent-ui/core", replacement: src("core/src/index.ts") },
      { find: "@open-intelligent-ui/react", replacement: src("react/src/index.ts") },
    ],
  },
  test: {
    include: ["packages/*/src/**/*.test.{ts,tsx}"],
  },
});
