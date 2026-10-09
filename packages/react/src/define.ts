import {
  slot as coreSlot,
  defineComponent as defineCoreComponent,
  type ComponentConfig,
  type DefinedComponent as CoreDefinedComponent,
  type Library as CoreLibrary,
  type LibraryDefinition as CoreLibraryDefinition,
} from "@open-intelligent-ui/core";
import type { ReactNode } from "react";
import type { z } from "zod/v4";
import type { $ZodObject } from "zod/v4/core";

export type {
  ActionSpec,
  Callback,
  ComponentGroup,
  LibraryJSONSchema,
  LibrarySpec,
  PromptOptions,
} from "@open-intelligent-ui/core";

/** What a component receives: react-lang's `props` and `renderNode`, plus nested `children`. */
export interface ComponentRenderProps<P = Record<string, unknown>> {
  props: P;
  renderNode: (value: unknown) => ReactNode;
  children?: ReactNode;
  /** Put on the outermost element: it animates the element in while streaming. */
  className?: string;
}

export type ComponentRenderer<P = Record<string, unknown>> = (
  props: ComponentRenderProps<P>,
) => ReactNode;

export type DefinedComponent<T extends $ZodObject = $ZodObject> = CoreDefinedComponent<
  T,
  ComponentRenderer<z.infer<T>>,
  ReactNode
>;

// `any`, as in react-lang: a library holds components with different props, and app code can
// call or wrap a component taken from it.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRenderer = ComponentRenderer<any>;

export type Library = CoreLibrary<AnyRenderer>;

export type LibraryDefinition = CoreLibraryDefinition<AnyRenderer>;

/** Schema for rendered content: nested markup as `children`, or an element-valued prop. */
export const slot = (): z.ZodType<ReactNode> => coreSlot<ReactNode>();

export function defineComponent<T extends $ZodObject>(
  config: ComponentConfig<T, ComponentRenderer<z.infer<T>>>,
): DefinedComponent<T> {
  return defineCoreComponent<T, ComponentRenderer<z.infer<T>>, ReactNode>(config);
}
