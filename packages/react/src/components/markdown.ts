import { MARKDOWN_TAGS } from "@open-intelligent-ui/core/compiler";
import type { DefinedComponent } from "../define";
import * as definitions from "./definitions";

const tags = new Set<string>(Object.values(MARKDOWN_TAGS));

/** The built-in versions of the tags compiled Markdown renders with. */
export const markdownComponents = (Object.values(definitions) as unknown[]).filter(
  (c): c is DefinedComponent =>
    !!c && typeof c === "object" && tags.has(String((c as { name?: unknown }).name)),
);
