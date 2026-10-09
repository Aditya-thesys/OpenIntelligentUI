const ELEMENT = Symbol("element");
export const Fragment = Symbol("fragment");

export type ComponentFn = (props: Record<string, unknown>) => unknown;

export interface Element {
  $$typeof: typeof ELEMENT;
  type: string | symbol | ComponentFn;
  props: Record<string, unknown>;
  key: string | null;
}

export function jsx(
  type: Element["type"],
  props: Record<string, unknown> | null,
  ...children: unknown[]
): Element {
  const p: Record<string, unknown> = { ...(props ?? {}) };
  let key: string | null = null;
  if (p.key !== undefined && p.key !== null) key = String(p.key);
  delete p.key;
  if (children.length) p.children = children;
  return { $$typeof: ELEMENT, type, props: p, key };
}

export const isElement = (v: unknown): v is Element =>
  !!v && typeof v === "object" && (v as Element).$$typeof === ELEMENT;
