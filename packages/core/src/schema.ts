import * as z from "zod/v4";
import type { $ZodType } from "zod/v4/core";

/** A function prop; calling it runs the program's handler in the sandbox. */
export type Callback = (...args: unknown[]) => void;

interface CallbackInfo {
  params: string;
}

const callbackChecks = new WeakMap<object, CallbackInfo>();
const slotChecks = new WeakSet<object>();

/**
 * Schema for a function prop; `params` documents its arguments in the prompt, and `A` types
 * them: `callback<[id: string]>({ params: "id: string" })`.
 */
export function callback<A extends unknown[] = unknown[]>(
  options: { params?: string } = {},
): z.ZodType<(...args: A) => void> {
  const check = (value: unknown) => typeof value === "function";
  callbackChecks.set(check, { params: options.params ?? "" });
  return z.custom<(...args: A) => void>(check);
}

/** Schema for rendered content: nested markup as `children`, or an element-valued prop. */
export function slot<Node = unknown>(): z.ZodType<Node> {
  const check = () => true;
  slotChecks.add(check);
  return z.custom<Node>(check);
}

const schemaNames = new WeakMap<object, string>();

/** Shows a schema by name in prompt signatures, e.g. `RouteStop[]`. */
export function tagSchemaId(schema: object, name: string): void {
  schemaNames.set(schema, name);
}

export const schemaName = (schema: object): string | undefined => schemaNames.get(schema);

const componentNames = new WeakMap<object, string>();

export const registerComponent = (props: object, name: string) => componentNames.set(props, name);

export const componentName = (schema: object): string | undefined => componentNames.get(schema);

interface Def {
  type: string;
  innerType?: $ZodType;
  element?: $ZodType;
  options?: $ZodType[];
  shape?: Record<string, $ZodType>;
  entries?: Record<string, string | number>;
  values?: unknown[];
  keyType?: $ZodType;
  valueType?: $ZodType;
  fn?: object;
  catchall?: $ZodType;
}

export function defOf(schema: unknown): Def | undefined {
  return (schema as { _zod?: { def?: Def } } | undefined)?._zod?.def;
}

const WRAPPERS = new Set(["optional", "default", "nullable", "prefault", "readonly", "catch"]);

export function unwrap(schema: $ZodType): $ZodType {
  let current = schema;
  let def = defOf(current);
  while (def && WRAPPERS.has(def.type) && def.innerType) {
    current = def.innerType;
    def = defOf(current);
  }
  return current;
}

const OPTIONAL = new Set(["optional", "default", "prefault", "nullable"]);

export function isOptional(schema: $ZodType): boolean {
  for (let def = defOf(schema); def && WRAPPERS.has(def.type); def = defOf(def.innerType)) {
    if (OPTIONAL.has(def.type)) return true;
    if (!def.innerType) break;
  }
  return false;
}

export function callbackInfo(schema: $ZodType): CallbackInfo | undefined {
  const def = defOf(unwrap(schema));
  return def?.type === "custom" && def.fn ? callbackChecks.get(def.fn) : undefined;
}

export function isSlot(schema: $ZodType): boolean {
  const def = defOf(unwrap(schema));
  return def?.type === "custom" && !!def.fn && slotChecks.has(def.fn);
}

export function objectShape(schema: unknown): Record<string, $ZodType> {
  return defOf(schema)?.shape ?? {};
}

export function stringChoices(schema: $ZodType): string[] | undefined {
  const def = defOf(unwrap(schema));
  if (def?.type === "enum" && def.entries) {
    const values = Object.values(def.entries);
    return values.every((v) => typeof v === "string") ? (values as string[]) : undefined;
  }
  if (def?.type === "literal" && def.values?.every((v) => typeof v === "string"))
    return def.values as string[];
  if (def?.type === "union" && def.options) {
    const parts = def.options.map(stringChoices);
    return parts.every(Boolean) ? (parts.flat() as string[]) : undefined;
  }
  return undefined;
}
