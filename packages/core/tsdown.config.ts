import { defineConfig } from "tsdown";

export default defineConfig({
  entry: { index: "src/index.ts", compiler: "src/compiler/index.ts" },
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  target: "es2022",
  outDir: "dist",
  clean: true,
});
