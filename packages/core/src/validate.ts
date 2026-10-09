import { safeParse, type $ZodObject, type $ZodType } from "zod/v4/core";
import {
  callbackInfo,
  componentName,
  defOf,
  isOptional,
  isSlot,
  objectShape,
  unwrap,
} from "./schema";

export interface PropIssue {
  code: "missing-required" | "type-mismatch";
  prop: string;
  message: string;
}

export interface ValidatedProps {
  props: Record<string, unknown>;
  issues: PropIssue[];
  omit: boolean;
}

export interface ValidateOptions {
  isNode: (value: unknown) => boolean;
}

/** Checks each declared prop on its own, so one bad value costs only that prop. */
export function validateProps(
  schema: $ZodObject,
  input: Record<string, unknown>,
  options: ValidateOptions,
): ValidatedProps {
  const props: Record<string, unknown> = isLoose(schema) ? { ...input } : {};
  const issues: PropIssue[] = [];
  let omit = false;
  for (const [key, field] of Object.entries(objectShape(schema))) {
    if (key === "children") continue;
    const value = input[key];
    const result = value === undefined ? parseMissing(field) : parseValue(field, value, options);
    if (result.ok) {
      if (result.value !== undefined) props[key] = result.value;
      else delete props[key];
      continue;
    }
    if (isOptional(field)) {
      const fallback = parseMissing(field);
      if (fallback.ok && fallback.value !== undefined) props[key] = fallback.value;
      else delete props[key];
      issues.push({
        code: "type-mismatch",
        prop: key,
        message: `Invalid value for "${key}" was ignored`,
      });
    } else {
      delete props[key];
      omit = true;
      issues.push(
        value === undefined
          ? { code: "missing-required", prop: key, message: `Required prop "${key}" is missing` }
          : { code: "type-mismatch", prop: key, message: `Required prop "${key}" is invalid` },
      );
    }
  }
  return { props, issues, omit };
}

const isLoose = (schema: $ZodObject) => {
  const catchall = defOf(schema)?.catchall;
  return !!catchall && defOf(catchall)?.type !== "never";
};

type Parsed = { ok: true; value: unknown } | { ok: false };

function parseMissing(field: $ZodType): Parsed {
  if (!isOptional(field)) return { ok: false };
  const result = safeParse(field, undefined);
  return result.success ? { ok: true, value: result.data } : { ok: true, value: undefined };
}

function parseValue(field: $ZodType, value: unknown, options: ValidateOptions): Parsed {
  const inner = unwrap(field);
  if (callbackInfo(inner)) return typeof value === "function" ? { ok: true, value } : { ok: false };
  if (acceptsNodes(inner)) {
    const nodes = Array.isArray(value) ? value : [value];
    return nodes.every((n) => options.isNode(n) || typeof n === "string" || typeof n === "number")
      ? { ok: true, value }
      : { ok: false };
  }
  const result = safeParse(field, value);
  if (result.success) return { ok: true, value: result.data };
  // Models write `prop={null}` to mean "not set".
  return value === null && isOptional(field) ? { ok: true, value: undefined } : { ok: false };
}

function acceptsNodes(schema: $ZodType): boolean {
  if (isSlot(schema) || componentName(schema)) return true;
  const def = defOf(schema);
  if (def?.type === "array" && def.element) return acceptsNodes(unwrap(def.element));
  if (def?.type === "union" && def.options?.length)
    return def.options.every((o) => acceptsNodes(unwrap(o)));
  return false;
}
