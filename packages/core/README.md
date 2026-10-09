# @open-intelligent-ui/core

The framework-agnostic half of the renderer: the compiler, the sandboxed runtime, and component libraries with prompt generation and prop validation. `@open-intelligent-ui/react` re-exports the library API with React component types; use this package directly to generate prompts on a server or to build a renderer for another framework.

## Component libraries

`defineComponent` and `createLibrary` take the same call shapes as OpenUI's react-lang (`name`, `props`, `description`, `component`; `components`, `componentGroups`, `id`). There is no `root` component, and `generatePrompt` takes prompt options as a second argument. A component with an empty description is left out of the prompt.

```ts
import { callback, createLibrary, defineComponent, slot } from "@open-intelligent-ui/core";
import { z } from "zod/v4";

const Button = defineComponent({
  name: "button",
  description: "Button",
  props: z.object({ label: z.string(), onClick: callback().optional(), children: slot() }),
  component: MyButton,
});

const library = createLibrary({ components: [Button] });
library.prompt({ preamble, additionalRules, examples, actions });
library.toJSONSchema();
```

| Export                                           | Description                                                                                           |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| `defineComponent(config)`                        | A component with `name`, `description`, zod `props` and an opaque `component`                         |
| `createLibrary({ components, componentGroups })` | A library with `prompt()`, `toSpec()` and `toJSONSchema()`                                            |
| `callback({ params })`                           | Schema for a function prop                                                                            |
| `slot()`                                         | Schema for rendered content (`children` or an element-valued prop)                                    |
| `tagSchemaId(schema, name)`                      | Show a schema by name in prompt signatures                                                            |
| `validateProps(schema, props, options)`          | Per-prop validation with streaming tolerance; returns the declared props, issues, and whether to omit |
| `generatePrompt(spec, options)`                  | The prompt for a prebuilt spec, for example one loaded from `toSpec()`                                |

`validateProps` passes on only the props a schema declares; a `z.looseObject` schema also passes the others, as the built-in SVG shapes do for their attributes.

| Prompt option     | Description                                                                                  |
| ----------------- | -------------------------------------------------------------------------------------------- |
| `preamble`        | Replaces the opening paragraph                                                               |
| `additionalRules` | Extra rules listed at the end                                                                |
| `examples`        | Complete example replies                                                                     |
| `actions`         | Actions programs may request with `action(name, ...args)`, with parameters and a description |
| `appData`         | What the renderer's `appData` contains; when set, the prompt teaches `useAppData()`          |

## Syntax

A response is Markdown with tags and logic. `console.log(library.prompt())` prints the rules exactly as the model sees them.

- Prose is Markdown: paragraphs, `#` headings, `**bold**`, `*italic*`, lists (nested by indent), links, code spans, fenced code blocks, `---` rules and pipe tables.
- `{expression}` outside code renders a JavaScript value. `{"{"}` and `{"<"}` write a literal brace or `<`; `{}` and comment-only braces render nothing.
- Tags look like JSX: `<slider min={0} value={n} onChange={setN}/>`. String props take quotes, other values braces, and a bare prop is `true`: `<button disabled>`.
- `{@body statement}` holds one top-level JavaScript statement, usually a declaration: `{@body const [n, setN] = useState(5)}`. One inside `{#each}` or `{#if}` is dropped (`body-in-block`).
- `{#each list as item, i}...{/each}` repeats content; give each row a `key` prop. Parameters can destructure (`as {name}`), and a trailing `(key)` is ignored.
- `{#if cond}...{:else if other}...{:else}...{/if}` picks a branch.
- With `orderStatements`, each statement runs after the declarations it uses, so data can follow the markup that shows it.
- Hooks are plain functions (see below); `action(name, ...args)` asks the host to act, from event handlers only.

## Compiler

`@open-intelligent-ui/core/compiler` compiles model output (Markdown, JSX-like tags, `{@body}` statements and `{#each}`/`{#if}` blocks) into a JavaScript program for the runtime. It has no browser code, so servers can import it.

```ts
import { compile } from "@open-intelligent-ui/core/compiler";

const { code, constants, diagnostics, fallbackText } = compile(source, {
  progressive: isStreaming,
  orderStatements: true,
});
```

The input may be a partial stream. Everything after the first unfinished construct is dropped, open elements that already have content are closed, and open elements without content are pruned, so every prefix compiles to a program that runs. Each expression is wrapped so one failing value renders as its fallback instead of stopping the program. In `progressive` mode, a sentence or label whose values do not exist yet waits instead of showing a gap.

| Option            | Description                                                                                                                                                |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `progressive`     | When the input ends inside a list declaration, keep its complete items so lists render item by item while streaming. A list that seeds state is never cut. |
| `orderStatements` | Reorder `{@body}` statements so each comes after the declarations it uses, which lets a response declare data after the markup                             |
| `components`      | The library's component names; an unknown capitalized tag that is never closed, as in `Press <Enter>`, is then read as text                                |

Diagnostics report where the input was cut (`unterminated-braced-value`, `unterminated-tag`, `unclosed-block`) and what was skipped (`unknown-directive`, `duplicate-declaration`, `body-in-block`, `too-deep`), with line, column and the directive or name involved. `HOOKS`, `ACTION_FUNCTION` and `MARKDOWN_TAGS` describe the language.

## Runtime and sandbox

`createEngine` is a small React-like engine: it runs a compiled program, diffs the element tree it renders, and emits operations (`create`, `createText`, `place`, `set`, `unset`, `text`, `destroy`). It has no DOM dependency.

- Hooks are plain functions: `useState` (keyed by variable name, so state survives statements being reordered between streamed versions), `useEffect`, `useMemo`, `useCallback`, `useRef`, `useId`, `useNow`, `useTimeout` and `useAppData`. `action(name, ...args)` forwards a request to the host, from event handlers only.
- `useTimeout(fn, ms)` calls `fn` after `ms` milliseconds, and again after each later render while `ms` is still a number (`null` stops it), on the host's clock: the sandbox itself has no timers.
- Function props stay in the engine and cross as stable slots (`{ $fn: "12.onChange" }`); `trigger(slot, args)` calls them.
- `update()` swaps in a newer program and keeps state. A program that fails, on load or on any later render, leaves the last good tree in place and reports `{ kind, message }`, where `kind` is `program`, `handler`, `effect` or `render-loop`.

`createSandbox` runs the engine in a Web Worker inside a hidden `sandbox="allow-scripts"` iframe whose CSP allows no network, images or styles. The worker removes network, timers, messaging and dynamic code evaluation before any program runs. A watchdog restarts a worker that does not answer within 2 seconds; a program that hangs three times within 10 seconds is quarantined.

```ts
import { createSandbox } from "@open-intelligent-ui/core";

const sandbox = createSandbox({
  onBatch: (batch) => applyOperations(batch.ops),
  onPersist: (state) => save(state),
  onHostCall: (name, args) => handleAction(name, args),
});
sandbox.load(code, constants);
sandbox.trigger("12.onChange", [9]);
sandbox.dispose();
```

Options also take `onRestart(reason, quarantined)` and `onIdle()` (every message sent so far was handled). Besides `load` and `trigger`, a sandbox has `update(code, constants)` for a newer program, `setData(appData)` and `setState(state)`.

The worker and the iframe bootstrap are bundled into `src/host/generated.ts` by `scripts/build-sandbox.mjs`, which runs as part of `build`.
