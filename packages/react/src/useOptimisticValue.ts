import { createContext, useContext, useEffect, useRef, useState } from "react";

/** Bumped each time the sandbox has handled every event sent to it. */
export const SettledContext = createContext(0);

/**
 * An input's value that updates at once while the sandbox round trip is in flight. `change`
 * shows the new value and sends it to `onChange`; once the sandbox has handled it, a value the
 * program did not take is replaced by the program's. An undefined `value` is uncontrolled: what
 * the user did stays.
 */
export function useOptimisticValue<T>(
  value: T | undefined,
  onChange: ((next: T) => void) | undefined,
  same: (sent: T, received: T) => boolean = Object.is,
): [T | undefined, (next: T) => void] {
  const [local, setLocal] = useState<T | undefined>(value);
  const pending = useRef<T[]>([]);
  const settled = useContext(SettledContext);
  const seen = useRef({ value, settled });
  useEffect(() => {
    const changed = !Object.is(seen.current.value, value);
    const handled = seen.current.settled !== settled;
    seen.current = { value, settled };
    const echoed = value === undefined ? -1 : pending.current.findIndex((p) => same(p, value));
    if (echoed >= 0) pending.current.splice(0, echoed + 1);
    else if (changed || (handled && pending.current.length)) {
      pending.current = [];
      setLocal(value);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, settled]);
  const change = (next: T) => {
    setLocal(next);
    if (!onChange) return;
    if (value !== undefined) pending.current.push(next);
    onChange(next);
  };
  return [local, change];
}
