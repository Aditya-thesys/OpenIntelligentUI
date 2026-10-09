// Captures what the engine needs, then locks the scope down before any program runs.
import { createEngine } from "./engine";
import { lockdown } from "./lockdown";
import type { FromWorker, ToWorker } from "./protocol";

const scope = globalThis as unknown as Record<string, unknown> & typeof globalThis;
const post = (scope.postMessage as (m: FromWorker) => void).bind(scope);
const addListener = scope.addEventListener.bind(scope);
const realSetInterval = scope.setInterval.bind(scope);
const realClearInterval = scope.clearInterval.bind(scope);
const realQueueMicrotask = scope.queueMicrotask.bind(scope);
const RealFunction = Function;

const engine = createEngine({
  emit: (batch) => post({ type: "batch", batch }),
  persistState: (state) => post({ type: "persist", state }),
  callHost: (name, args) => post({ type: "host", name, args }),
  evaluate: (code, names, values) => {
    RealFunction(...names, '"use strict";\n' + code)(...values);
  },
  setInterval: (fn, ms) => realSetInterval(fn, ms),
  clearInterval: (h) => realClearInterval(h as number),
  queueMicrotask: realQueueMicrotask,
});

// Throws when the scope cannot be locked down; the worker then never answers and is replaced.
lockdown(scope);

addListener("message", (event: MessageEvent<ToWorker>) => {
  // A program can dispatch synthetic events at its own scope; only real messages count.
  if (!event.isTrusted) return;
  const msg = event.data;
  switch (msg.type) {
    case "load":
      engine.load(msg);
      break;
    case "update":
      engine.update(msg);
      break;
    case "setData":
      engine.setData(msg.appData);
      break;
    case "setState":
      engine.setState(msg.state);
      break;
    case "trigger":
      engine.trigger(msg.slot, msg.args);
      break;
  }
  post({ type: "done", seq: msg.seq });
});
