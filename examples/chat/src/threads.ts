import {
  useThread,
  useThreadList,
  type ChatStorage,
  type Message,
  type Thread,
} from "@openuidev/react-headless";
import { useEffect } from "react";

// react-headless's default in-memory storage keeps only each thread's first message, so going
// back to a thread lost its answers. This one keeps whole threads, saved by SaveThread.
let threads: Thread[] = [];
const saved = new Map<string, Message[]>();

export const storage: ChatStorage = {
  thread: {
    listThreads: async () => ({ threads }),
    async createThread(first) {
      const title = typeof first.content === "string" ? first.content.slice(0, 40) : "";
      const thread = {
        id: crypto.randomUUID(),
        title: title || "New chat",
        createdAt: new Date().toISOString(),
      };
      threads = [thread, ...threads];
      saved.set(thread.id, [{ ...first, id: first.id ?? crypto.randomUUID() }]);
      return thread;
    },
    getMessages: async (id) => saved.get(id) ?? [],
    async updateThread(thread) {
      threads = threads.map((t) => (t.id === thread.id ? thread : t));
      return thread;
    },
    async deleteThread(id) {
      threads = threads.filter((t) => t.id !== id);
      saved.delete(id);
    },
  },
};

/** Saves the open thread's messages once an answer has finished. Render it once in the chat. */
export function SaveThread() {
  const { messages, isRunning, isLoadingMessages } = useThread();
  const id = useThreadList((s) => s.selectedThreadId);
  useEffect(() => {
    if (id && !isRunning && !isLoadingMessages && messages.length) saved.set(id, messages);
  }, [id, messages, isRunning, isLoadingMessages]);
  return null;
}
