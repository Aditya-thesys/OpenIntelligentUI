import type { $ZodObject, $ZodType } from "zod/v4/core";
import type { ComponentGroup } from "./library";
import type { PromptSpec } from "./prompt";
import {
  callbackInfo,
  componentName,
  defOf,
  isOptional,
  isSlot,
  objectShape,
  schemaName,
  stringChoices,
  unwrap,
} from "./schema";

interface SignatureSource {
  name: string;
  props: $ZodObject;
  description: string;
}

interface Printed {
  name: string;
  shape: Record<string, $ZodType>;
  fields: string[];
}

const MIN_SPREAD = 4;

// A component with every prop of an earlier one spreads it and lists only what it changes:
// `<title {...text} size?="sm|lg">`, which keeps the prompt short.
export function buildSignatures(
  components: SignatureSource[],
  groups: ComponentGroup[] | undefined,
): Pick<PromptSpec, "components" | "types"> {
  const byName = new Map(components.filter((c) => c.description).map((c) => [c.name, c]));
  const order = new Set([...(groups ?? []).flatMap((g) => g.components), ...byName.keys()]);
  const printed: Printed[] = [];
  const named = new Map<string, $ZodType>();
  const out: PromptSpec["components"] = {};
  for (const name of order) {
    const c = byName.get(name);
    if (c)
      out[name] = {
        signature: componentSignature(c.name, c.props, printed, named),
        description: c.description,
      };
  }
  const types: Record<string, string> = {};
  // Named types can mention other named types, which are added while this loop runs.
  for (const [name, schema] of named) types[name] = typeName(schema, named, true);
  return { components: out, types };
}

function componentSignature(
  name: string,
  props: $ZodObject,
  printed: Printed[],
  named: Map<string, $ZodType>,
): string {
  const shape = objectShape(props);
  const fields = Object.keys(shape).filter((key) => key !== "children");
  const base = printed.find(
    (p) =>
      p.fields.every((k) => k in shape) &&
      p.fields.filter((k) => p.shape[k] === shape[k]).length >= MIN_SPREAD,
  );
  printed.push({ name, shape, fields });
  const own = base ? fields.filter((k) => base.shape[k] !== shape[k]) : fields;
  const attrs = [
    ...(base ? [`{...${base.name}}`] : []),
    ...own.map((key) => attribute(key, shape[key], named)),
  ];
  const open = `<${name}${attrs.map((a) => ` ${a}`).join("")}`;
  const children = shape["children"];
  if (!children) return `${open}/>`;
  return `${open}>${childTags(children) ?? ""}…</${name}>`;
}

function attribute(key: string, schema: $ZodType, named: Map<string, $ZodType>): string {
  const name = isOptional(schema) ? `${key}?` : key;
  const inner = unwrap(schema);
  const def = defOf(inner);
  if (schemaName(inner)) return `${name}={${typeName(inner, named)}}`;
  if (def?.type === "boolean") return name === key ? `${key}={boolean}` : name;
  return `${name}=${valueNotation(inner, named)}`;
}

function valueNotation(inner: $ZodType, named: Map<string, $ZodType>): string {
  const choices = stringChoices(inner);
  if (choices) return `"${choices.join("|")}"`;
  const def = defOf(inner);
  if (def?.type === "union" && def.options) {
    const listed = def.options.filter((o) => !schemaName(unwrap(o)) && stringChoices(o));
    const strings = listed.flatMap((o) => stringChoices(o) ?? []);
    const rest = def.options.filter((o) => !listed.includes(o));
    const anyString = rest.filter((o) => defOf(unwrap(o))?.type === "string");
    const others = rest.filter((o) => !anyString.includes(o));
    if (strings.length) {
      const values = `"${strings.join("|")}${anyString.length ? "|…" : ""}"`;
      return others.length
        ? `${values}|{${others.map((o) => typeName(o, named)).join("|")}}`
        : values;
    }
  }
  return `{${typeName(inner, named)}}`;
}

function childTags(schema: $ZodType): string | null {
  const inner = unwrap(schema);
  const def = defOf(inner);
  const element = def?.type === "array" && def.element ? unwrap(def.element) : inner;
  const elementDef = defOf(element);
  const options = elementDef?.type === "union" ? (elementDef.options ?? []) : [element];
  const names = options.map((o) => componentName(unwrap(o)));
  return names.length && names.every(Boolean) ? names.map((n) => `<${n}/>`).join("|") : null;
}

function typeName(schema: $ZodType, named: Map<string, $ZodType>, expand = false): string {
  const inner = unwrap(schema);
  const ref = componentName(inner);
  if (ref) return `<${ref}/>`;
  const tag = schemaName(inner);
  if (tag && !expand) {
    named.set(tag, inner);
    return tag;
  }
  if (expand && (stringChoices(inner) || defOf(inner)?.type === "union"))
    return valueNotation(inner, named);
  const callback = callbackInfo(inner);
  if (callback) return `(${callback.params}) => …`;
  if (isSlot(inner)) return "<…/>";
  const choices = stringChoices(inner);
  if (choices) return choices.map((c) => `"${c}"`).join("|");
  const def = defOf(inner);
  switch (def?.type) {
    case "string":
    case "number":
    case "boolean":
    case "null":
    case "undefined":
      return def.type;
    case "array": {
      if (!def.element) return "any[]";
      const element = typeName(def.element, named);
      const item = unwrap(def.element);
      const isUnion = !schemaName(item) && (defOf(item)?.type === "union" || !!stringChoices(item));
      return isUnion ? `(${element})[]` : `${element}[]`;
    }
    case "union":
      return (def.options ?? []).map((o) => typeName(o, named)).join("|");
    case "object":
      return `{${Object.entries(def.shape ?? {})
        .map(([k, v]) => `${k}${isOptional(v) ? "?" : ""}: ${typeName(v, named)}`)
        .join(", ")}}`;
    case "record":
      return `Record<string, ${def.valueType ? typeName(def.valueType, named) : "any"}>`;
    case "literal":
      return (def.values ?? []).map((v) => JSON.stringify(v)).join("|");
    default:
      return "any";
  }
}
