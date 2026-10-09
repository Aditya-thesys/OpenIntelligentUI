import { describe, expect, it } from "vitest";
import { chatCompletionTextStream } from "../textStream";

describe("chatCompletionTextStream", () => {
  it("yields content deltas across chunk boundaries and skips other lines", async () => {
    const chunks = [
      'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\ndata: {"choi',
      'ces":[{"delta":{"content":"lo"}}]}\n\n: keep-alive\n\ndata: [DONE]\n\n',
    ];
    const body = new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
        controller.close();
      },
    });
    const parts: string[] = [];
    for await (const part of chatCompletionTextStream(new Response(body))) parts.push(part);
    expect(parts).toEqual(["Hel", "lo"]);
  });
});
