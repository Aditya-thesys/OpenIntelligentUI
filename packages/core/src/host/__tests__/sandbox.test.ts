import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { compile } from "../../compiler";
import type { FromSandbox, FromWorker } from "../../runtime/protocol";
import { INIT_MESSAGE } from "../constants";
import { BOOTSTRAP_SOURCE } from "../generated";

const path = (p: string) => fileURLToPath(new URL(p, import.meta.url));

async function workerSource() {
  const result = await build({
    entryPoints: [path("../../runtime/worker.ts")],
    bundle: true,
    format: "iife",
    write: false,
  });
  return result.outputFiles[0]?.text ?? "";
}

/** A global scope like a worker's, with the APIs the lockdown must remove. */
function workerScope() {
  const posted: FromWorker[] = [];
  let onMessage: ((event: { data: unknown; isTrusted: boolean }) => void) | undefined;
  const scope = vm.createContext({
    postMessage: (message: FromWorker) => posted.push(message),
    addEventListener: (_type: string, listener: typeof onMessage) => (onMessage = listener),
    setInterval,
    clearInterval,
    setTimeout,
    queueMicrotask,
    fetch: () => undefined,
    XMLHttpRequest: class {},
    WebSocket: class {},
  });
  const send = (data: unknown) => onMessage?.({ data, isTrusted: true });
  return { scope, posted, send };
}

describe("worker lockdown", () => {
  it("removes network, timers and dynamic code before programs run", async () => {
    const { scope, posted, send } = workerScope();
    vm.runInContext(await workerSource(), scope);
    const probe = (expr: string) =>
      `{(() => { try { return ${expr} } catch (e) { return "blocked" } })()}`;
    const out = compile(
      `<text>${probe("typeof fetch")} ${probe("typeof setTimeout")} ${probe('eval("1")')} ${probe(
        '(() => {}).constructor("return 1")()',
      )}</text>`,
    );
    send({ type: "load", seq: 1, code: out.code, constants: out.constants });
    const batch = posted.find((m) => m.type === "batch");
    const text =
      batch?.type === "batch" ? batch.batch.ops.find((o) => o.op === "createText") : null;
    expect(text).toMatchObject({ text: "undefined undefined blocked blocked" });
  });
});

describe("sandbox watchdog", () => {
  afterEach(() => vi.useRealTimers());

  it("restarts a hanging worker, then quarantines the program", () => {
    vi.useFakeTimers();
    const workers: { posted: unknown[]; terminated: boolean }[] = [];
    const fromSandbox: FromSandbox[] = [];
    const parent = {};
    let onMessage: ((event: unknown) => void) | undefined;
    const scope = vm.createContext({
      parent,
      addEventListener: (_type: string, listener: typeof onMessage) => (onMessage = listener),
      Blob: class {},
      URL: { createObjectURL: () => "blob:worker" },
      Worker: class {
        state = { posted: [] as unknown[], terminated: false };
        constructor() {
          workers.push(this.state);
        }
        postMessage(message: unknown) {
          this.state.posted.push(message);
        }
        terminate() {
          this.state.terminated = true;
        }
      },
      setTimeout,
      clearTimeout,
      setInterval,
      clearInterval,
    });
    scope["window"] = scope;
    vm.runInContext(BOOTSTRAP_SOURCE, scope);
    let seq = 1;
    const load = () => ({ type: "load", seq: seq++, code: "__ui.render(null)" });
    // Like the page, answer a restart by sending the program again.
    const port = {
      onmessage: null as ((event: { data: unknown }) => void) | null,
      postMessage: (message: FromSandbox) => {
        fromSandbox.push(message);
        if (message.type === "restarted" && !message.quarantined)
          port.onmessage?.({ data: load() });
      },
    };
    onMessage?.({ source: parent, data: { type: INIT_MESSAGE }, ports: [port] });
    port.onmessage?.({ data: load() });

    vi.advanceTimersByTime(2000);
    expect(fromSandbox).toEqual([
      expect.objectContaining({ type: "restarted", quarantined: false }),
    ]);
    expect(workers[1]?.posted).toEqual([expect.objectContaining({ type: "load", seq: 2 })]);

    vi.advanceTimersByTime(4000);
    expect(fromSandbox.at(-1)).toMatchObject({ type: "restarted", quarantined: true });
    const count = workers.length;
    port.onmessage?.({ data: { type: "update", seq: 2, code: "" } });
    vi.advanceTimersByTime(4000);
    expect(workers.length).toBe(count);
    expect(fromSandbox.filter((m) => m.type === "restarted")).toHaveLength(3);
  });
});
