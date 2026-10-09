import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts", "src/chat.tsx"],
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  target: "es2022",
  outDir: "dist",
  clean: true,
  copy: ["src/styles.css"],
});
