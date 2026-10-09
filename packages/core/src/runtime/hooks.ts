import type { HOOKS } from "../compiler";
import type { ComponentFn } from "./element";

export const ROOT = "root";
const KEY_SEP = "\u0000";
const MAX_STATE_KEYS = 256;
const MIN_TIMER_MS = 50;

type Hook =
  | { kind: "state"; key: string }
  | { kind: "effect"; deps?: unknown[]; cleanup?: unknown }
  | { kind: "memo"; deps?: unknown[]; value: unknown }
  | { kind: "ref"; value: { current: unknown } }
  | { kind: "id"; value: string }
  | { kind: "now"; ms: number; handle?: unknown }
  | { kind: "timeout"; ms: number | null | undefined; handle?: unknown; fn: () => unknown };

type HookOf<K extends Hook["kind"]> = Extract<Hook, { kind: K }>;

interface Instance {
  path: string;
  hooks: Hook[];
  seen: boolean;
}

const depsChanged = (a: unknown[] | undefined, b: unknown[] | undefined) =>
  !a || !b || a.length !== b.length || a.some((x, i) => !Object.is(x, b[i]));

/**
 * The program's state values, keyed by component path and variable name. The root component's
 * named values are saved under their plain name, so a saved state reads like `{ seats: 8 }`.
 */
export class ProgramState {
  private values: Record<string, unknown> = {};
  private setters = new Map<string, (next: unknown) => void>();
  /** Set by a change; the engine clears it when it persists. */
  changed = false;

  constructor(private readonly onChange: () => void) {}

  use(key: string, init: unknown): [unknown, (next: unknown) => void] {
    if (!(key in this.values)) {
      if (Object.keys(this.values).length >= MAX_STATE_KEYS)
        throw new Error("Too many state values");
      this.values[key] = typeof init === "function" ? (init as () => unknown)() : init;
    }
    let set = this.setters.get(key);
    if (!set) {
      set = (next) => this.set(key, next);
      this.setters.set(key, set);
    }
    return [this.values[key], set];
  }

  private set(key: string, next: unknown) {
    const prev = this.values[key];
    const value = typeof next === "function" ? (next as (p: unknown) => unknown)(prev) : next;
    if (Object.is(prev, value)) return;
    this.values[key] = value;
    this.changed = true;
    this.onChange();
  }

  snapshot(): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(this.values)) {
      const name = k.split(KEY_SEP)[1];
      out[k.startsWith(ROOT + KEY_SEP) && !name.startsWith("#") ? name : k] = v;
    }
    return out;
  }

  restore(saved: Record<string, unknown> | undefined) {
    this.values = {};
    for (const [k, v] of Object.entries(saved ?? {}))
      this.values[k.includes(KEY_SEP) ? k : `${ROOT}${KEY_SEP}${k}`] = v;
  }
}

export interface HookHost {
  state: ProgramState;
  appData(): unknown;
  now(): number;
  setInterval?(fn: () => void, ms: number): unknown;
  clearInterval?(handle: unknown): void;
  /** A timer fired: re-render, or run `fn` as an effect, unless the program was stopped. */
  timerFired(fn?: () => unknown): void;
}

/** Runs function components and keeps their hooks, one instance per position in the tree. */
export class Components {
  /** Effects of the current render, run by the engine after it commits. */
  readonly effects: (() => void)[] = [];
  readonly hooks: Record<(typeof HOOKS)[number], unknown>;
  private instances = new Map<string, Instance>();
  private current: Instance | null = null;
  private index = 0;
  private ids = 0;

  constructor(private readonly host: HookHost) {
    this.hooks = {
      useState: this.useState,
      useEffect: this.useEffect,
      useMemo: this.useMemo,
      useCallback: <T>(fn: T, deps?: unknown[]) => this.useMemo(() => fn, deps),
      useRef: (init?: unknown) =>
        this.use("ref", () => ({ kind: "ref", value: { current: init } })).value,
      useId: () => this.use("id", () => ({ kind: "id", value: `ui-${++this.ids}` })).value,
      useNow: this.useNow,
      useTimeout: this.useTimeout,
      useAppData: (select?: (d: unknown) => unknown) =>
        select ? select(host.appData()) : host.appData(),
    };
  }

  render(fn: ComponentFn, props: Record<string, unknown>, path: string): unknown {
    let inst = this.instances.get(path);
    if (!inst) {
      inst = { path, hooks: [], seen: true };
      this.instances.set(path, inst);
    } else inst.seen = true;
    const prev = this.current;
    const prevIndex = this.index;
    this.current = inst;
    this.index = 0;
    try {
      return fn(props);
    } finally {
      this.current = prev;
      this.index = prevIndex;
    }
  }

  beginPass() {
    for (const inst of this.instances.values()) inst.seen = false;
  }

  /** Unmounts the components the last pass did not render. */
  sweep() {
    for (const [path, inst] of this.instances) {
      if (inst.seen) continue;
      for (const h of inst.hooks) {
        if (h.kind === "effect" && typeof h.cleanup === "function") (h.cleanup as () => void)();
        this.stopTimer(h);
      }
      this.instances.delete(path);
    }
  }

  private use<K extends Hook["kind"]>(kind: K, make: () => HookOf<K>): HookOf<K> {
    const inst = this.current;
    if (!inst) throw new Error("Hooks can only be called while rendering");
    const i = this.index++;
    const h = inst.hooks[i];
    if (h?.kind === kind) return h as HookOf<K>;
    if (h) this.stopTimer(h);
    const made = make();
    inst.hooks[i] = made;
    return made;
  }

  private useState = (init: unknown, options?: { key?: string }) => {
    const index = this.index;
    let hook = this.use("state", () => ({ kind: "state", key: "" }));
    const inst = this.current!;
    const key = `${inst.path}${KEY_SEP}${options?.key ?? `#${index}`}`;
    // Statement order can change between streamed versions; a keyed state never takes over
    // another key's slot.
    if (hook.key !== key) {
      hook = { kind: "state", key };
      inst.hooks[index] = hook;
    }
    return this.host.state.use(key, init);
  };

  private useEffect = (fn: () => unknown, deps?: unknown[]) => {
    const h = this.use("effect", () => ({ kind: "effect" }));
    if (!depsChanged(h.deps, deps)) return;
    h.deps = deps;
    this.effects.push(() => {
      if (typeof h.cleanup === "function") (h.cleanup as () => void)();
      h.cleanup = fn();
    });
  };

  private useMemo = <T>(fn: () => T, deps?: unknown[]): T => {
    const h = this.use("memo", () => ({ kind: "memo", value: undefined }));
    if (depsChanged(h.deps, deps)) {
      h.value = fn();
      h.deps = deps;
    }
    return h.value as T;
  };

  private useNow = (enabled: boolean = true, ms?: number): number => {
    const interval = Math.max(MIN_TIMER_MS, Number(ms) || 1000);
    const h = this.use("now", () => ({ kind: "now", ms: interval }));
    if (!enabled || h.ms !== interval) this.stopTimer(h);
    h.ms = interval;
    if (enabled && h.handle === undefined && this.host.setInterval)
      h.handle = this.host.setInterval(() => this.host.timerFired(), interval);
    return this.host.now();
  };

  // Runs `fn` once, `ms` after `ms` becomes a number; `null` cancels. After it fired, a render
  // that still passes a number starts it again, so `fn` updating state makes a countdown.
  // The host exposes only interval timers; a timeout is an interval that stops on its first tick.
  private useTimeout = (fn: () => unknown, ms?: number | null) => {
    const h = this.use("timeout", () => ({ kind: "timeout", ms: null, fn }));
    h.fn = fn;
    const delay = typeof ms === "number" && Number.isFinite(ms) ? Math.max(MIN_TIMER_MS, ms) : null;
    if (delay === h.ms) return;
    this.stopTimer(h);
    h.ms = delay;
    if (delay === null || !this.host.setInterval) return;
    h.handle = this.host.setInterval(() => {
      this.stopTimer(h);
      h.ms = undefined;
      this.host.timerFired(() => h.fn());
    }, delay);
  };

  private stopTimer(h: Hook) {
    if ((h.kind === "now" || h.kind === "timeout") && h.handle !== undefined) {
      this.host.clearInterval?.(h.handle);
      h.handle = undefined;
    }
  }
}
