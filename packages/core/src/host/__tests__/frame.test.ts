// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { createSandbox } from "../sandbox";

afterEach(() => vi.useRealTimers());

it("quarantines a program whose frame keeps dying", () => {
  vi.useFakeTimers();
  const restarts: boolean[] = [];
  // jsdom does not run the frame's script, so no message is ever answered.
  const sb = createSandbox({ onBatch: () => {}, onRestart: (_, q) => restarts.push(q) });
  sb.load("__ui.render(null)");
  vi.advanceTimersByTime(60_000);
  expect(restarts).toEqual([false, false, true]);
  expect(document.querySelectorAll("iframe")).toHaveLength(0);
  sb.dispose();
});
