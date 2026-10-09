import * as z from "zod/v4";
import type { $ZodObject, $ZodType } from "zod/v4/core";
import { generatePrompt, type ComponentPromptSpec, type PromptOptions } from "./prompt";
import { callbackInfo, isSlot, registerComponent } from "./schema";
import { buildSignatures } from "./signature";

/** A component the model can use; `C` is the framework's renderer, `Node` its rendered content. */
export interface DefinedComponent<T extends $ZodObject = $ZodObject, C = unknown, Node = unknown> {
  name: string;
  props: T;
  description: string;
  component: C;
  /** Schema for a prop that takes this element: `header: Title.ref`. */
  ref: z.ZodType<Node>;
}

export interface ComponentConfig<T extends $ZodObject, C> {
  name: string;
  props: T;
  /** Shown in the prompt; empty keeps the component out of it. */
  description: string;
  component: C;
}

export interface ComponentGroup {
  name: string;
  components: string[];
  notes?: string[];
}

export interface LibraryJSONSchema {
  $defs?: Record<string, Record<string, unknown>>;
  [key: string]: unknown;
}

export interface LibrarySpec {
  id?: string;
  components: Record<string, ComponentPromptSpec>;
  componentGroups?: ComponentGroup[];
  types?: Record<string, string>;
  schema: LibraryJSONSchema;
}

function assertZod4(schema: unknown, name: string) {
  const isZod3 = !!schema && typeof schema === "object" && "_def" in schema && !("_zod" in schema);
  if (isZod3)
    throw new Error(`Component "${name}" uses a Zod 3 schema. Use zod 4 and import from "zod/v4".`);
}

/** Defines a component. */
export function defineComponent<T extends $ZodObject, C, Node = unknown>(
  config: ComponentConfig<T, C>,
): DefinedComponent<T, C, Node> {
  assertZod4(config.props, config.name);
  registerComponent(config.props, config.name);
  return { ...config, ref: config.props as unknown as z.ZodType<Node> };
}

export interface LibraryDefinition<C = unknown> {
  /** A later component replaces an earlier one with the same name. */
  components: DefinedComponent<$ZodObject, C, unknown>[];
  componentGroups?: ComponentGroup[];
  id?: string;
}

export interface Library<C = unknown> {
  readonly components: Record<string, DefinedComponent<$ZodObject, C, unknown>>;
  readonly componentGroups: ComponentGroup[] | undefined;
  readonly id: string | undefined;
  /** The system prompt that teaches the model the language and these components. */
  prompt(options?: PromptOptions): string;
  toSpec(): LibrarySpec;
  toJSONSchema(): LibraryJSONSchema;
}

/** Creates a component library. */
export function createLibrary<C = unknown>(definition: LibraryDefinition<C>): Library<C> {
  const components: Library<C>["components"] = {};
  for (const component of definition.components) components[component.name] = component;
  const { componentGroups, id } = definition;
  for (const group of componentGroups ?? [])
    for (const name of group.components)
      if (!components[name])
        throw new Error(`Component group "${group.name}" lists unknown component "${name}".`);

  const signatures = () => buildSignatures(Object.values(components), componentGroups);

  function toJSONSchema(): LibraryJSONSchema {
    const registry = z.registry<{ id: string }>();
    for (const c of Object.values(components)) registry.add(c.props, { id: c.name });
    const combined = z.object(
      Object.fromEntries(Object.values(components).map((c) => [c.name, c.props as $ZodType])),
    );
    const schema = z.toJSONSchema(combined, {
      metadata: registry,
      unrepresentable: "any",
      override: ({ zodSchema, jsonSchema }) => {
        const callback = callbackInfo(zodSchema as $ZodType);
        if (callback) jsonSchema["x-callback"] = callback.params;
        else if (isSlot(zodSchema as $ZodType)) jsonSchema["x-slot"] = true;
      },
    }) as LibraryJSONSchema;
    for (const c of Object.values(components)) {
      const def = schema.$defs?.[c.name];
      if (def && c.description) def["description"] = c.description;
    }
    return schema;
  }

  return {
    components,
    componentGroups,
    id,
    prompt: (options) => generatePrompt({ ...signatures(), componentGroups }, options),
    toSpec: () => ({
      ...(id !== undefined ? { id } : {}),
      ...signatures(),
      componentGroups,
      schema: toJSONSchema(),
    }),
    toJSONSchema,
  };
}
