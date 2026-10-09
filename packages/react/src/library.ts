import { createLibrary as createCoreLibrary } from "@open-intelligent-ui/core";
import { markdownComponents } from "./components/markdown";
import type { Library, LibraryDefinition } from "./define";

/** Creates a component library, adding built-ins for any Markdown tag it does not define. */
export function createLibrary(definition: LibraryDefinition): Library {
  const names = new Set(definition.components.map((c) => c.name));
  return createCoreLibrary({
    ...definition,
    components: [...markdownComponents.filter((c) => !names.has(c.name)), ...definition.components],
  });
}
