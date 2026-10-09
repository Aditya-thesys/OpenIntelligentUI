import { useEffect, useRef, useState } from "react";

// Compiling and re-running the program for every token is wasted work.
export function useStreamingThrottle(value: string, streaming: boolean, ms: number): string {
  const [shown, setShown] = useState(value);
  const last = useRef(0);
  const latest = useRef(value);
  latest.current = value;
  useEffect(() => {
    if (!streaming) return;
    const timer = setTimeout(
      () => {
        last.current = Date.now();
        setShown(latest.current);
      },
      Math.max(0, last.current + ms - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [value, streaming, ms]);
  return streaming ? shown : value;
}
