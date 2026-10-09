import type { Batch } from "../runtime/engine";
import type { FromSandbox, ToWorker } from "../runtime/protocol";
import { INIT_MESSAGE, MAX_RESTARTS } from "./constants";
import { BOOTSTRAP_SOURCE } from "./generated";

export interface SandboxOptions {
  onBatch(batch: Batch): void;
  onPersist?(state: Record<string, unknown>): void;
  onHostCall?(name: string, args: unknown[]): void;
  /** The sandbox stopped answering and was replaced; `quarantined` when it gave up. */
  onRestart?(reason: string, quarantined: boolean): void;
  /** Every message sent so far has been handled. */
  onIdle?(): void;
  container?: HTMLElement;
}

// Omit applied to each member, so `Command` stays a union discriminated by `type`.
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
type Command = DistributiveOmit<Exclude<ToWorker, { type: "ping" }>, "seq">;

const SANDBOX_CSP =
  "default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' blob:; worker-src blob:; style-src 'none'; img-src 'none'";

// The iframe restarts a stuck worker within about 2 s; a message unanswered for longer means the
// iframe itself died (for example out of memory), so the page replaces it.
const FRAME_DEADLINE_MS = 6000;
const FRAME_RESTART_WINDOW_MS = 60_000;

function sandboxHtml(): string {
  const script = BOOTSTRAP_SOURCE.replace(/<\/script/gi, "<\\/script");
  return `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="${SANDBOX_CSP}"></head><body><script>${script}</script></body></html>`;
}

/** Runs programs in a Web Worker inside a hidden `sandbox="allow-scripts"` iframe. */
export function createSandbox(options: SandboxOptions) {
  let iframe: HTMLIFrameElement;
  let port: MessagePort;
  let disposed = false;
  let quarantined = false;
  let seq = 1;
  let frameRestarts: number[] = [];
  const deadlines = new Map<number, ReturnType<typeof setTimeout>>();
  // Everything sent so far as one load, to start over in a new worker or frame.
  let replay: Extract<Command, { type: "load" }> | null = null;

  const clearDeadlines = () => {
    for (const t of deadlines.values()) clearTimeout(t);
    deadlines.clear();
  };

  const onMessage = (e: MessageEvent<FromSandbox>) => {
    const msg = e.data;
    switch (msg.type) {
      case "done":
        clearTimeout(deadlines.get(msg.seq));
        deadlines.delete(msg.seq);
        if (!deadlines.size) options.onIdle?.();
        break;
      case "batch":
        options.onBatch(msg.batch);
        break;
      case "persist":
        if (replay) replay = { ...replay, state: msg.state };
        options.onPersist?.(msg.state);
        break;
      case "host":
        options.onHostCall?.(msg.name, msg.args);
        break;
      case "restarted":
        clearDeadlines();
        quarantined = msg.quarantined;
        options.onRestart?.(msg.reason, msg.quarantined);
        if (replay && !quarantined) post(replay);
        break;
    }
  };

  const mount = () => {
    iframe = document.createElement("iframe");
    iframe.setAttribute("sandbox", "allow-scripts");
    iframe.setAttribute("aria-hidden", "true");
    iframe.title = "sandbox";
    iframe.style.cssText = "position:absolute;width:0;height:0;border:0;visibility:hidden";
    iframe.srcdoc = sandboxHtml();
    let channel: MessageChannel;
    const connect = () => {
      channel = new MessageChannel();
      port = channel.port1;
      port.onmessage = onMessage;
    };
    connect();
    let loads = 0;
    // Moving the iframe in the DOM reloads it with a fresh document: reconnect and replay.
    iframe.addEventListener("load", () => {
      if (loads++ > 0) {
        port.close();
        connect();
        if (restarted("the sandbox frame reloaded") && replay) post(replay);
      }
      iframe.contentWindow?.postMessage({ type: INIT_MESSAGE }, "*", [channel.port2]);
    });
    (options.container ?? document.body).appendChild(iframe);
  };

  // The frame counts its worker restarts, but a new frame starts that count over, so the page
  // counts frame restarts itself. False once the sandbox gives up.
  const restarted = (reason: string) => {
    clearDeadlines();
    const now = Date.now();
    frameRestarts = frameRestarts.filter((t) => now - t < FRAME_RESTART_WINDOW_MS);
    frameRestarts.push(now);
    quarantined = frameRestarts.length > MAX_RESTARTS;
    options.onRestart?.(reason, quarantined);
    return !quarantined;
  };

  const replaceFrame = () => {
    port.close();
    iframe.remove();
    if (!restarted("the sandbox frame stopped answering")) return;
    mount();
    if (replay) post(replay);
  };

  const post = (cmd: Command) => {
    const n = seq++;
    port.postMessage({ ...cmd, seq: n });
    deadlines.set(n, setTimeout(replaceFrame, FRAME_DEADLINE_MS));
  };

  const send = (cmd: Command) => {
    if (disposed || quarantined) return;
    if (cmd.type === "load") replay = cmd;
    else if (replay && cmd.type === "update")
      replay = { ...replay, code: cmd.code, constants: cmd.constants };
    else if (replay && cmd.type === "setData") replay = { ...replay, appData: cmd.appData };
    else if (replay && cmd.type === "setState") replay = { ...replay, state: cmd.state };
    post(cmd);
  };

  mount();

  return {
    load: (
      code: string,
      constants?: Record<string, unknown>,
      appData?: unknown,
      state?: Record<string, unknown>,
    ) => send({ type: "load", code, constants, appData, state }),
    update: (code: string, constants?: Record<string, unknown>) =>
      send({ type: "update", code, constants }),
    setData: (appData: unknown) => send({ type: "setData", appData }),
    setState: (state: Record<string, unknown>) => send({ type: "setState", state }),
    trigger: (slot: string, args: unknown[] = []) => send({ type: "trigger", slot, args }),
    dispose() {
      disposed = true;
      clearDeadlines();
      port.close();
      iframe.remove();
    },
  };
}

export type Sandbox = ReturnType<typeof createSandbox>;
