import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv } from "vite";
import { directionsRoute } from "./server/directions";
import { modelProxy } from "./server/model-proxy";
import { placesRoute } from "./server/places";

const root = fileURLToPath(new URL("../..", import.meta.url));

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, root, "");
  return {
    plugins: [
      react(),
      modelProxy({
        path: "/api/chat",
        apiKey: env["OPENROUTER_API_KEY"],
        model: env["CHAT_MODEL"] || "openai/gpt-6-sol",
        reasoning: env["CHAT_REASONING"] || "none",
        systemPrompt: async (server) => {
          const mod = await server.ssrLoadModule("/src/library.ts");
          return (mod as typeof import("./src/library")).systemPrompt();
        },
      }),
      placesRoute(),
      directionsRoute(),
    ],
  };
});
