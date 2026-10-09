/** Text deltas of a chat-completions SSE stream; throws on a stream error. */
export async function* chatCompletionTextStream(response: Response): AsyncGenerator<string> {
  const reader = response.body?.pipeThrough(new TextDecoderStream()).getReader();
  if (!reader) return;
  let buffer = "";
  try {
    for (let read = await reader.read(); ; read = await reader.read()) {
      buffer += read.value ?? "";
      const lines = buffer.split("\n");
      buffer = read.done ? "" : (lines.pop() ?? "");
      for (const line of lines) {
        const delta = parseLine(line);
        if (delta) yield delta;
      }
      if (read.done) return;
    }
  } finally {
    reader.cancel().catch(() => {});
  }
}

function parseLine(line: string): string | undefined {
  const data = line.startsWith("data:") ? line.slice(5).trim() : "";
  if (!data || data === "[DONE]") return undefined;
  let payload: { error?: { message?: string }; choices?: { delta?: { content?: unknown } }[] };
  try {
    payload = JSON.parse(data);
  } catch {
    return undefined;
  }
  if (payload.error) throw new Error(payload.error.message ?? "The model stream failed");
  const delta = payload.choices?.[0]?.delta?.content;
  return typeof delta === "string" ? delta : undefined;
}
