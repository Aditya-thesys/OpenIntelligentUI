import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

export function StreamText({ text, streaming }: { text: string; streaming: boolean }) {
  const previous = useRef("");
  const before = previous.current;
  useEffect(() => {
    previous.current = text;
  }, [text]);
  if (!streaming || !before || !text.startsWith(before) || text.length === before.length)
    return <>{text}</>;
  return (
    <>
      {before}
      <span key={text.length} className="oui-fresh">
        {text.slice(before.length)}
      </span>
    </>
  );
}

// React 18 warns about useLayoutEffect during server rendering.
const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

export function GrowingHeight({ active, children }: { active: boolean; children: ReactNode }) {
  const inner = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | undefined>(undefined);
  useIsoLayoutEffect(() => {
    const el = inner.current;
    if (!active || !el) return;
    const observer = new ResizeObserver(() => setHeight(el.offsetHeight));
    observer.observe(el);
    return () => {
      observer.disconnect();
      setHeight(undefined);
    };
  }, [active]);
  return (
    <div
      className="oui-grow"
      style={
        active && height !== undefined
          ? { height, overflow: "clip", transition: "height 320ms cubic-bezier(.16,1,.3,1)" }
          : undefined
      }
    >
      <div ref={inner}>{children}</div>
    </div>
  );
}
