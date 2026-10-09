# @open-intelligent-ui/react

Define a component library with zod schemas, generate the system prompt from it, and render streamed model output in a sandbox with your React components.

## Install

```bash
pnpm add @open-intelligent-ui/react zod
```

## Define components

```tsx
import { callback, defineComponent, slot } from "@open-intelligent-ui/react";
import { z } from "zod/v4";

export const Slider = defineComponent({
  name: "slider",
  description: "Numeric slider",
  props: z.object({
    min: z.number(),
    max: z.number(),
    step: z.number().optional(),
    value: z.number(),
    onChange: callback({ params: "value: number" }),
  }),
  component: ({ props }) => (
    <input
      type="range"
      min={props.min}
      max={props.max}
      step={props.step}
      value={props.value}
      onChange={(e) => props.onChange(Number(e.target.value))}
    />
  ),
});

export const Panel = defineComponent({
  name: "panel",
  description: "Titled panel",
  props: z.object({ header: slot().optional(), children: slot() }),
  component: ({ props, children }) => (
    <section>
      {props.header}
      {children}
    </section>
  ),
});
```

- `name` is the tag the model writes: `<slider .../>`.
- `callback()` declares a function prop. At render time it is a real function; calling it runs the program's handler in the sandbox. `params` documents the arguments for the prompt, and `callback<[value: number]>()` types them. Arguments must be JSON values and DOM events are dropped, so pass `e.target.value`, not the event.
- `slot()` declares rendered content. `children` receives nested markup; any other slot prop receives an element passed as a value, `header={<title>Hi</title>}`. Use `Other.ref` instead of `slot()` to say which component a prop or `children` expects. `.ref` values also arrive as rendered elements, so a parent cannot read a child's props, and the named component is a hint for the prompt that is not enforced at runtime.
- `tagSchemaId(schema, "Name")` makes prompt signatures show `Name` instead of the schema's full shape.
- Components receive `{ props, renderNode, children, className }`. `props` and `renderNode` work as in OpenUI's react-lang: `renderNode(value)` renders a prop value that holds elements, strings or arrays of them. Unlike react-lang, nested markup also arrives as `children`, because tags nest the way JSX does; when the schema declares `children`, `props.children` holds the same rendered nodes. `className` is set while an element is newly revealed during streaming; put it on the outermost element.
- Props that hold URLs or free-form CSS should use `schemas.linkUrl`, `schemas.imageUrl` or `schemas.cssString`, which reject `javascript:` links and values that load resources.

For inputs, `useOptimisticValue(props.value, props.onChange)` keeps a local value so typing never waits on the sandbox round trip, and returns to the program's value when the program does not take a change. With no program value (`undefined`), the field is uncontrolled and keeps what the user typed.

`useStateField(name, initial)` keeps a field of the response's state, as react-lang's hook of the same name: components in one response that use the same name share it, and the Renderer reports it through `onStateUpdate` (under `"@fields"`, next to the program's state variables) and restores it from `initialState`. Use it for edits the model should see on the next turn. Names are not scoped by form as in react-lang: one name is one field per response.

## Create a library and a prompt

```ts
import { builtinComponents, builtinGroups, createLibrary } from "@open-intelligent-ui/react";

export const library = createLibrary({
  components: [...builtinComponents, Slider, Panel],
  componentGroups: [...builtinGroups, { name: "Custom", components: ["slider", "panel"] }],
});

const systemPrompt = library.prompt({
  preamble: "You are a helpful assistant.",
  additionalRules: ["Prefer one well designed widget over several."],
  examples: [
    "Pick a number.\n{@body const [n, setN] = useState(5)}\n<slider min={0} max={10} value={n} onChange={setN}/>\nYou picked {n}.",
  ],
  actions: [{ name: "openUrl", params: "url: string", description: "opens a link" }],
});
```

A later component replaces an earlier one with the same name, so a library can restyle any built-in. The prompt lists each component as a tag signature, for example `<slider min={number} max={number} step?={number} value={number} onChange={(value: number) => …}/>`, grouped and annotated with the group notes, after the language rules. `library.toJSONSchema()` and `library.toSpec()` serialize the library.

## Render

```tsx
import { Renderer } from "@open-intelligent-ui/react";
import "@open-intelligent-ui/react/styles.css";

<Renderer
  library={library}
  response={text}
  isStreaming={streaming}
  onError={(errors) => console.warn(errors)}
  onAction={({ name, args: [url] }) => {
    // Arguments come from model-written code.
    if (name === "openUrl" && typeof url === "string" && /^https:\/\//.test(url)) window.open(url);
  }}
  onStateUpdate={saveState}
  initialState={savedState}
/>;
```

| Prop                            | Description                                                                                                     |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `response`                      | The model's text; may be a growing stream prefix                                                                |
| `library`                       | From `createLibrary()`                                                                                          |
| `isStreaming`                   | Enables partial-list rendering and the streaming reveal                                                         |
| `onError`                       | Problems the model could fix, reported when streaming ends and again with `[]` once resolved                    |
| `onAction`                      | The program called `action(name, ...args)` from an event handler; validate the arguments                        |
| `onStateUpdate`, `initialState` | Persist and restore program state and `useStateField` fields; a later `initialState` replaces the current state |
| `appData`                       | Read-only data the program reads with `useAppData`                                                              |
| `onParseResult`                 | Each compile result, with diagnostics                                                                           |
| `fallbackMessage`               | Shown above the plain-text version when the program cannot be displayed                                         |
| `theme`                         | `"light"` (default) or `"dark"`: pass the host page's scheme; the OS setting is never consulted                 |
| `className`                     | Added to the root element                                                                                       |

Errors are `OpenUIError` objects with the same shape as in OpenUI Lang (`source`, `code`, `message`, `component`, `path`, `hint`). Codes: compiler diagnostics (`unterminated-tag`, `unclosed-block`, ...), `unknown-component`, `missing-required` and `type-mismatch` (an invalid optional prop falls back to its default or is ignored; for a required prop the element is not rendered, and `hint` says so), `render-error`, `runtime-error`, `handler-error`, `effect-error`, `render-loop`, `undefined-name` (an expression used a name the program never declared, so it rendered empty), `sandbox-restarted` and `sandbox-quarantined`.

Render one `Renderer` per response, keyed by the response's id: it owns that response's state and its sandbox (a hidden iframe with a Web Worker) while it is mounted. While streaming, a heading waits until something visible follows it, for up to a second. When the program fails, the last good tree stays and the renderer adds the response's plain text below it; when the sandbox gives up on the program, the plain text replaces the tree.

## Built-in components

`builtinComponents` and `builtinGroups` cover layout (`box`, `row`, `grid`, `card`, `pressable`, `form`, ...), text (`text`, `title`, `caption`, `badge`, `icon`, `link`, ...), inputs (`button`, `input`, `select`, `segmented-control`, `radio-group`, `slider`, `checkbox`, `date-picker`, ...), data (`table`, `image`, `chart`) and SVG drawing. `builtinLibrary` is a library of just these, and the `builtins` namespace exports each definition (`builtins.Slider`, ...). They read CSS variables (`--oui-*`) from `styles.css`, so a host can restyle them without replacing them.

`createLibrary` always includes the components compiled Markdown renders with (`text`, `title`, `bold`, `italic`, `code`, `code-block`, `link`, `list`, `list-item`, `divider` and the table tags), using the built-in versions unless the library defines its own. The Markdown-only ones have empty descriptions, which keeps them out of the prompt.

## Streaming a response

`chatCompletionTextStream(response)` yields the text of a chat-completions SSE stream, for apps that pass the text straight to `Renderer`:

```ts
for await (const delta of chatCompletionTextStream(await fetch("/api/chat", init)))
  setResponse((text) => text + delta);
```

## OpenUI chat interfaces

`@open-intelligent-ui/react/chat` connects OpenUI's react-ui `AgentInterface` to `Renderer`:

```tsx
import { createChatBridge, type AssistantMessageProps } from "@open-intelligent-ui/react/chat";
import { openAIAdapter, openAIMessageFormat } from "@openuidev/react-headless";
import { AgentInterface, fetchLLM, useTheme } from "@openuidev/react-ui";

const bridge = createChatBridge();
const llm = fetchLLM({
  url: "/api/chat",
  streamAdapter: bridge.streamAdapter(openAIAdapter()),
  messageFormat: bridge.messageFormat(openAIMessageFormat),
});

function AssistantMessage(props: Pick<AssistantMessageProps, "message" | "isStreaming">) {
  return <bridge.AssistantMessage {...props} library={library} theme={useTheme().mode} />;
}

<AgentInterface llm={llm} components={{ AssistantMessage }} />;
```

This needs `@openuidev/react-headless` and `@openuidev/react-ui` 0.17 or later; [`examples/chat/src/main.tsx`](../../examples/chat/src/main.tsx) is a complete app.

The stream adapter lets `AgentInterface` show answers while they stream (it otherwise waits for OpenUI Lang syntax), and the message format sends each answer back with the state the user left it in. Add `stateNoteRule` from the same module to the prompt's `additionalRules` so the model knows what that note means.
