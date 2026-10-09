import { ACTION_FUNCTION, HOOKS } from "../compiler";
import { INTERNAL } from "../compiler/language";
import { Fragment, isElement, jsx, type ComponentFn } from "./element";
import { Components, ProgramState } from "./hooks";
import { Reconciler, type Op } from "./reconcile";

export { Fragment, jsx } from "./element";
export { TEXT_NODE } from "./reconcile";
export type { EncodedElement, NodeId, Op } from "./reconcile";

export type ProgramErrorKind = "program" | "handler" | "effect" | "render-loop";

export interface ProgramError {
  kind: ProgramErrorKind;
  message: string;
}

export interface Batch {
  ops: Op[];
  error?: ProgramError;
  /** Messages of the ReferenceErrors this render skipped: names the program never declared. */
  undefinedNames?: string[];
}

export interface EngineHost {
  emit(batch: Batch): void;
  persistState?(state: Record<string, unknown>): void;
  callHost?(name: string, args: unknown[]): void;
  evaluate?(code: string, names: string[], values: unknown[]): void;
  setInterval?(fn: () => void, ms: number): unknown;
  clearInterval?(handle: unknown): void;
  queueMicrotask?(fn: () => void): void;
  now?(): number;
}

export interface LoadInput {
  code: string;
  constants?: Record<string, unknown>;
  appData?: unknown;
  state?: Record<string, unknown>;
}

const MAX_RENDERS_PER_INPUT = 50;

/** Runs one program: renders it, schedules re-renders, and reports changes to the host. */
export function createEngine(host: EngineHost) {
  const enqueue = host.queueMicrotask ?? ((fn: () => void) => Promise.resolve().then(fn));
  const evaluate =
    host.evaluate ??
    ((code: string, names: string[], values: unknown[]) =>
      new Function(...names, '"use strict";\n' + code)(...values));

  let root: ComponentFn | null = null;
  let constants: Record<string, unknown> = {};
  let appData: unknown = {};
  let rendersSinceInput = 0;
  let looping = false;
  let handlingEvent = 0;
  let dirty = false;
  let scheduled = false;
  let batching = 0;
  const undefinedNames = new Set<string>();

  const state = new ProgramState(invalidate);
  const components = new Components({
    state,
    appData: () => appData,
    now: host.now ?? (() => Date.now()),
    setInterval: host.setInterval,
    clearInterval: host.clearInterval,
    timerFired(fn) {
      if (looping) return;
      rendersSinceInput = 0;
      if (fn) outside(fn, "effect");
      else invalidate();
    },
  });
  const reconciler = new Reconciler(components);

  const internal = Object.freeze({
    jsx,
    Fragment,
    render(el: unknown) {
      if (!isElement(el) || typeof el.type !== "function")
        throw new Error("render expects a component element");
      root = el.type;
    },
    useConstants: () => constants,
    undefinedName(error: unknown) {
      if (error instanceof ReferenceError) undefinedNames.add(error.message);
    },
  });
  // Actions run only in a user's event handler, so a program cannot act on its own, for
  // example send chat messages in a loop from an effect.
  const action = (name: unknown, ...args: unknown[]) => {
    if (typeof name !== "string") return;
    if (handlingEvent) host.callHost?.(name, toJson(args) ?? []);
    else
      fail("handler", `${ACTION_FUNCTION}("${name}") was ignored: call it from an event handler`);
  };
  const globals: [name: string, value: unknown][] = [
    ...HOOKS.map((name): [string, unknown] => [name, components.hooks[name]]),
    [ACTION_FUNCTION, action],
  ];

  function fail(kind: ProgramErrorKind, error: unknown) {
    host.emit({ ops: [], error: { kind, message: String(error) } });
  }

  function commit() {
    if (!root) return;
    // A render that throws commits nothing, so the page keeps the last good tree.
    let ops: Op[];
    undefinedNames.clear();
    try {
      ops = reconciler.diff(reconciler.render(root));
    } finally {
      components.sweep();
    }
    host.emit(undefinedNames.size ? { ops, undefinedNames: [...undefinedNames] } : { ops });
    for (const run of components.effects.splice(0)) {
      try {
        run();
      } catch (e) {
        fail("effect", e);
      }
    }
  }

  // Saved once per render rather than on every change, so typing does not copy the state per key.
  function persist() {
    if (!state.changed) return;
    state.changed = false;
    const saved = toJson(state.snapshot());
    if (saved) host.persistState?.(saved);
  }

  function flush() {
    scheduled = false;
    if (!dirty) return;
    dirty = false;
    persist();
    // State set during every render (for example by an effect without dependencies) would
    // otherwise re-render forever on microtasks, which the host's watchdog cannot see.
    if (++rendersSinceInput > MAX_RENDERS_PER_INPUT) {
      components.effects.length = 0;
      looping = true;
      fail("render-loop", `Rendering stopped after ${MAX_RENDERS_PER_INPUT} updates in a row`);
      return;
    }
    try {
      commit();
    } catch (e) {
      components.effects.length = 0;
      fail("program", e);
    }
  }

  function input() {
    rendersSinceInput = 0;
    looping = false;
  }

  // The handler's own effects may not call `action`, so the flag drops before the render; its
  // error is reported after the render, whose clean batch would otherwise clear it.
  function outside(fn: () => unknown, kind: "handler" | "effect") {
    let error: unknown;
    let failed = false;
    if (kind === "handler") handlingEvent++;
    batching++;
    try {
      fn();
    } catch (e) {
      error = e;
      failed = true;
    } finally {
      batching--;
      if (kind === "handler") handlingEvent--;
    }
    if (dirty) flush();
    if (failed) fail(kind, error);
  }

  function invalidate() {
    dirty = true;
    if (batching || scheduled) return;
    scheduled = true;
    enqueue(flush);
  }

  // Evaluates and renders `code`; on failure the previous program keeps running.
  function run(code: string, nextConstants: Record<string, unknown>) {
    const previous = { root, constants };
    root = null;
    constants = nextConstants;
    try {
      evaluate(
        code,
        [INTERNAL.jsx, ...globals.map(([name]) => name)],
        [internal, ...globals.map(([, value]) => value)],
      );
      if (!root) throw new Error("program did not call render");
      commit();
    } catch (e) {
      ({ root, constants } = previous);
      components.effects.length = 0;
      fail("program", e);
    }
  }

  return {
    load(program: LoadInput) {
      input();
      appData = program.appData ?? {};
      state.restore(program.state);
      run(program.code, program.constants ?? {});
    },
    update(program: { code: string; constants?: Record<string, unknown> }) {
      input();
      run(program.code, program.constants ?? constants);
    },
    setData(data: unknown) {
      input();
      appData = data;
      invalidate();
    },
    setState(saved: Record<string, unknown>) {
      input();
      state.restore(saved);
      invalidate();
    },
    trigger(slot: string, args: unknown[] = []) {
      const fn = reconciler.handlers.get(slot);
      if (!fn) return;
      input();
      outside(() => fn(...args), "handler");
    },
  };
}

export type Engine = ReturnType<typeof createEngine>;

function toJson<T>(value: T): T | null {
  try {
    return JSON.parse(JSON.stringify(value)) as T;
  } catch {
    return null;
  }
}
