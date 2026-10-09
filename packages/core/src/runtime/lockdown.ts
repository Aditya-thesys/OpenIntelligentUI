/**
 * Hygiene, not the boundary. Programs are arbitrary JavaScript in the engine's realm and
 * can still reach some async callbacks (promises, prototype methods) and patch built-ins, so the
 * page treats every operation the worker sends as untrusted. The boundaries are the iframe's
 * opaque origin, its CSP (no network), and the watchdog that replaces a stuck worker.
 */
export function lockdown(scope: Record<string, unknown>) {
  const remove = [
    "fetch",
    "XMLHttpRequest",
    "WebSocket",
    "WebTransport",
    "EventSource",
    "importScripts",
    "indexedDB",
    "caches",
    "BroadcastChannel",
    "MessageChannel",
    "MessagePort",
    "AbortSignal",
    "scheduler",
    "Worker",
    "SharedWorker",
    "Request",
    "Response",
    "postMessage",
    "addEventListener",
    "removeEventListener",
    "onmessage",
    "close",
    "setTimeout",
    "setInterval",
    "clearTimeout",
    "clearInterval",
    "requestAnimationFrame",
    "navigator",
    "location",
    "crypto",
    "FileReader",
    "WebAssembly",
  ];
  for (const name of remove) {
    try {
      Object.defineProperty(scope, name, {
        value: undefined,
        configurable: false,
        writable: false,
      });
    } catch {
      // Checked below: a global that cannot be redefined stops the worker.
    }
  }
  const left = remove.filter((name) => scope[name] !== undefined);
  if (left.length) throw new Error(`sandbox lockdown failed for: ${left.join(", ")}`);
  const blocked = function () {
    throw new Error("dynamic code evaluation is disabled in the sandbox");
  };
  Object.defineProperty(scope, "eval", { value: blocked, configurable: false, writable: false });
  for (const proto of [
    Function.prototype,
    Object.getPrototypeOf(async function () {}),
    Object.getPrototypeOf(function* () {}),
    Object.getPrototypeOf(async function* () {}),
  ]) {
    Object.defineProperty(proto, "constructor", {
      value: blocked,
      configurable: false,
      writable: false,
    });
  }
  Object.defineProperty(scope, "Function", {
    value: blocked,
    configurable: false,
    writable: false,
  });
}
