import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin, ViteDevServer } from "vite";

export interface ModelProxyOptions {
  path: string;
  apiKey: string | undefined;
  model: string;
  reasoning?: string;
  maxTokens?: number;
  maxHistory?: number;
  systemPrompt: (server: ViteDevServer) => Promise<string>;
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

const MAX_BODY_BYTES = 256 * 1024;
const UPSTREAM_TIMEOUT_MS = 60_000;

async function readJson(req: IncomingMessage): Promise<unknown> {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (body.length > MAX_BODY_BYTES) throw new Error("request body too large");
  }
  return JSON.parse(body || "{}");
}

// System messages from the client are dropped: the prompt is built on the server.
function conversation(body: unknown, maxHistory: number): ChatMessage[] {
  const messages = (body as { messages?: unknown } | null)?.messages;
  if (!Array.isArray(messages)) return [];
  return messages
    .filter(
      (m): m is ChatMessage =>
        !!m &&
        typeof m === "object" &&
        (m.role === "user" || m.role === "assistant") &&
        typeof m.content === "string" &&
        m.content.length > 0,
    )
    .map(({ role, content }) => ({ role, content }))
    .slice(-maxHistory);
}

// JSON, so the chat UI shows the message instead of the status line.
function fail(res: ServerResponse, status: number, error: string) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify({ error }));
}

/** Dev-server endpoint streaming completions from OpenRouter; the key stays on the server. */
export function modelProxy(options: ModelProxyOptions): Plugin {
  const { path, apiKey, model, reasoning, maxTokens = 8000, maxHistory = 20 } = options;
  return {
    name: "model-proxy",
    configureServer(server) {
      server.middlewares.use(path, async (req, res) => {
        if (req.method !== "POST") {
          res.statusCode = 405;
          res.end();
          return;
        }
        // A cross-site page can POST text/plain without a preflight; it must not spend the key.
        if (!req.headers["content-type"]?.startsWith("application/json"))
          return fail(res, 415, "Expected application/json.");
        if (!apiKey)
          return fail(res, 503, "Set OPENROUTER_API_KEY in .env.local to enable the model.");
        let messages: ChatMessage[];
        try {
          messages = conversation(await readJson(req), maxHistory);
        } catch {
          return fail(res, 400, "Expected a JSON body with messages.");
        }
        const controller = new AbortController();
        let clientGone = false;
        res.on("close", () => {
          clientGone = true;
          controller.abort();
        });
        // Only until the response starts: a long answer may stream for minutes.
        const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
        try {
          const upstream = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST",
            signal: controller.signal,
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
            body: JSON.stringify({
              model,
              stream: true,
              max_tokens: maxTokens,
              ...(reasoning ? { reasoning: { effort: reasoning } } : {}),
              messages: [
                { role: "system", content: await options.systemPrompt(server) },
                ...messages,
              ],
            }),
          });
          clearTimeout(timer);
          res.statusCode = upstream.status;
          res.setHeader(
            "Content-Type",
            upstream.headers.get("content-type") ?? "text/event-stream",
          );
          res.setHeader("Cache-Control", "no-cache");
          const reader = upstream.body?.getReader();
          for (let read = await reader?.read(); read && !read.done; read = await reader?.read())
            res.write(read.value);
        } catch (error) {
          clearTimeout(timer);
          if (!clientGone && !res.headersSent) res.statusCode = 502;
          if (!clientGone) server.config.logger.error(String(error));
        }
        res.end();
      });
    },
  };
}
