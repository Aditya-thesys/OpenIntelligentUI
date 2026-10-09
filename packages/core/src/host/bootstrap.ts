// Runs inside the sandbox iframe: relays messages and restarts a worker that stops answering.
// The page replays the program after a restart, so this frame keeps no copy of it.
import { INIT_MESSAGE, MAX_RESTARTS } from "./constants";

declare const __WORKER_SOURCE__: string;

const TIMEOUT_MS = 2000;
const RESTART_WINDOW_MS = 10_000;
type Msg = { type: string; seq?: number; [k: string]: unknown };

let port: MessagePort | null = null;
let worker: Worker | null = null;
let workerUrl = "";
let loaded = false;
const timers = new Map<number, ReturnType<typeof setTimeout>>();
let restarts: number[] = [];
let quarantined = false;
// The iframe's own messages (heartbeats) use negative numbers, apart from the page's.
let ownSeq = -1;

function startWorker() {
  if (!workerUrl)
    workerUrl = URL.createObjectURL(new Blob([__WORKER_SOURCE__], { type: "text/javascript" }));
  worker = new Worker(workerUrl);
  worker.onmessage = (e: MessageEvent<Msg>) => {
    const msg = e.data;
    if (msg.type === "done") {
      const t = timers.get(msg.seq as number);
      if (t !== undefined) clearTimeout(t);
      timers.delete(msg.seq as number);
      // The page keeps its own deadline for its messages, in case this frame dies.
      if ((msg.seq as number) > 0) port?.postMessage(msg);
      return;
    }
    port?.postMessage(msg);
  };
  worker.onerror = (e) => {
    e.preventDefault();
    restart(`the sandbox worker failed: ${e.message}`);
  };
}

function send(msg: Msg) {
  if (!worker) return;
  worker.postMessage(msg);
  const s = msg.seq as number;
  timers.set(
    s,
    setTimeout(() => restart(`no answer to ${msg.type} within ${TIMEOUT_MS} ms`), TIMEOUT_MS),
  );
}

function restart(reason: string) {
  worker?.terminate();
  worker = null;
  for (const t of timers.values()) clearTimeout(t);
  timers.clear();
  const now = Date.now();
  restarts = restarts.filter((t) => now - t < RESTART_WINDOW_MS);
  restarts.push(now);
  quarantined = restarts.length > MAX_RESTARTS;
  if (!quarantined) startWorker();
  port?.postMessage({ type: "restarted", reason, quarantined });
}

window.addEventListener("message", (event) => {
  if (event.source !== window.parent || port || !event.data || event.data.type !== INIT_MESSAGE)
    return;
  port = event.ports[0];
  port.onmessage = (e: MessageEvent<Msg>) => {
    if (quarantined) return;
    loaded ||= e.data.type === "load";
    send(e.data);
  };
  startWorker();
  // Work outside a message (timers, promise callbacks) is only seen by this heartbeat.
  setInterval(() => {
    if (worker && loaded && !quarantined && timers.size === 0)
      send({ type: "ping", seq: ownSeq-- });
  }, TIMEOUT_MS);
});
