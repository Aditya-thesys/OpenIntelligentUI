import { createContext, useCallback, useContext, useSyncExternalStore } from "react";

type Listener = () => void;

export class ResponseStateStore {
  private state: Record<string, unknown>;
  private listeners = new Set<Listener>();

  constructor(
    initial: Record<string, unknown>,
    private readonly onChange: (values: Record<string, unknown>) => void,
  ) {
    this.state = initial;
  }

  get(key: string): unknown {
    return this.state[key];
  }

  values(): Record<string, unknown> {
    return this.state;
  }

  replace(values: Record<string, unknown>) {
    this.state = values;
    this.listeners.forEach((listener) => listener());
  }

  set(key: string, value: unknown) {
    if (Object.is(this.state[key], value)) return;
    this.state = { ...this.state, [key]: value };
    this.listeners.forEach((listener) => listener());
    this.onChange(this.state);
  }

  subscribe = (listener: Listener) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
}

// Not a valid identifier, so it never collides with a program's state variable.
export const FIELDS_KEY = "@fields";

export const ResponseStateContext = createContext<ResponseStateStore | null>(null);

export interface StateField<T> {
  name: string;
  value: T;
  setValue: (value: T) => void;
  /** Always false. It is here so components written for react-lang's StateField port unchanged. */
  isReactive: false;
}

/** A field of the response's state, shared by name and reported through `onStateUpdate`. */
export function useStateField<T>(name: string, initial?: T): StateField<T> {
  const store = useContext(ResponseStateContext);
  if (!store) throw new Error("useStateField must be used inside a component rendered by Renderer");
  const stored = useSyncExternalStore(
    store.subscribe,
    () => store.get(name),
    () => undefined,
  );
  const setValue = useCallback((value: T) => store.set(name, value), [store, name]);
  return {
    name,
    value: (stored === undefined ? initial : stored) as T,
    setValue,
    isReactive: false,
  };
}
