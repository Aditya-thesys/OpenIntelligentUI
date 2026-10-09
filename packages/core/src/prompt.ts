import { ACTION_FUNCTION } from "./compiler";
import type { ComponentGroup } from "./library";

export interface ComponentPromptSpec {
  signature: string;
  description?: string;
}

/** Something the app does when a program calls `action("<name>", ...)`. */
export interface ActionSpec {
  name: string;
  params?: string;
  description: string;
}

export interface PromptOptions {
  /** Replaces the opening paragraph. */
  preamble?: string;
  additionalRules?: string[];
  examples?: string[];
  actions?: ActionSpec[];
  /** What the renderer's `appData` contains; when set, the prompt teaches `useAppData()`. */
  appData?: string;
}

export interface PromptSpec {
  components: Record<string, ComponentPromptSpec>;
  componentGroups?: ComponentGroup[];
  types?: Record<string, string>;
}

const PREAMBLE = `You answer with Markdown mixed with interactive UI. The whole reply is one document that is compiled and rendered live while you write it.
Build UI when the user will do something with the answer: plan, compare, calculate, track, choose or play. Answer a plain question in Markdown.`;

const SYNTAX = `## Syntax
- Prose is Markdown: paragraphs, \`#\` headings, \`**bold**\`, \`*italic*\`, \`-\` and \`1.\` lists, \`[links](https://...)\`, inline code in backticks, fenced code blocks, \`---\` rules and pipe tables. No blockquotes or Markdown images; show images with a component.
- \`{\` starts an expression everywhere outside code. Write a literal brace or \`<\` in prose as \`{"{"}\` or \`{"<"}\`; for code, use code spans or blocks.
- UI tags look like JSX: \`<Tag size="sm" value={x} onChange={setX}>...</Tag>\`. String props use quotes; every other value uses \`{expression}\` with JavaScript inside. A boolean prop can be written bare: \`<Tag disabled>\`.
- Logic goes in \`{@body ...}\` lines, never inside \`{#each}\` or \`{#if}\`, one JavaScript statement each:
  \`{@body const [seats, setSeats] = useState(8)}\`
  \`{@body const price = seats * 29}\`
- State: \`useState(initial)\` returns \`[value, setValue]\`. Other hooks work as in React: \`useMemo\`, \`useEffect\`, \`useRef\`. Call hooks directly, without a namespace, and only in \`{@body}\` lines at the top level, never inside \`{#each}\` or \`{#if}\`.
- Time: \`useNow(running, ms)\` returns the current time in milliseconds (a number, not an array) and re-renders every \`ms\` while \`running\` is true; use it for clocks and countdowns. \`useTimeout(fn, ms)\` calls \`fn\` after \`ms\` milliseconds, and again after each later render while \`ms\` is still a number; pass \`null\` to stop it. To flip two unmatched cards back: \`useTimeout(() => setOpen([]), open.length === 2 ? 800 : null)\`.
- Loops: \`{#each items as item, i} ... {/each}\`. Give each repeated element a unique \`key\` prop. Conditions: \`{#if cond} ... {:else if other} ... {:else} ... {/if}\`.
- \`{expression}\` in text renders its value: \`Total: {"$" + total.toLocaleString()}\`.
- Event handlers are JavaScript: \`onClick={() => setCount(count + 1)}\`, \`onChange={setValue}\` (receives the new value). Only the events listed on components exist (no keyboard events), so never promise keyboard shortcuts.
- No imports, no network, no \`setTimeout\` or \`setInterval\`. Do not wrap the reply in code fences.`;

const ORDER = `## Writing order
The reply renders while you write it, so write it in reading order:
- Open with one or two sentences of prose, and a title for a tool or game, before any \`{@body}\` line.
- Write each \`{@body}\` line right before the first markup or prose that uses it, never all the logic up front. Two exceptions: event handler functions follow the markup that calls them, and a list of several items goes right after the markup that shows it, one item per line, so it appears item by item.
- Keep handlers in markup to one short call, such as \`onClick={() => flip(card)}\`, and write the function in a \`{@body}\` line after that markup; a long inline handler holds its element back until the handler is written.
- A game or quiz: title, one line on how to play, then each part with only the state it needs right above it (the score row, then the board or question card), then its data list, then the handler functions.
- Finish one section (heading, markup, its list) before starting the next.
- A \`useState\` initial value uses only values written above it.
- Write each part once; never repeat a block.`;

export function generatePrompt(spec: PromptSpec, options: PromptOptions = {}): string {
  const parts = [options.preamble ?? PREAMBLE, SYNTAX, ORDER, componentsSection(spec)];
  if (options.appData)
    parts.push(
      `## App data\n\`useAppData()\` returns read-only data from the app: ${options.appData}`,
    );
  if (options.actions?.length) parts.push(actionsSection(options.actions));
  if (options.examples?.length)
    parts.push(
      [
        "## Examples",
        "Each example is a complete reply between `--- Example N ---` and `--- End ---` lines.",
        ...options.examples.map((e, i) => `--- Example ${i + 1} ---\n${e.trim()}\n--- End ---`),
      ].join("\n\n"),
    );
  if (options.additionalRules?.length)
    parts.push(["## Rules", ...options.additionalRules.map((r) => `- ${r}`)].join("\n"));
  return parts.join("\n\n");
}

function componentsSection(spec: PromptSpec): string {
  const signatures = Object.values(spec.components).map((c) => c.signature);
  const spread = signatures.map((sig) => /\{\.\.\.([\w-]+)\}/u.exec(sig)?.[1]).find(Boolean);
  const legend = [
    "Props marked `?` are optional. `{type}` gives the value type: write strings in quotes and everything else in braces.",
    signatures.some((sig) => sig.includes('="'))
      ? '`"a|b"` lists the allowed strings; `…` at the end means other strings work too.'
      : null,
    spread
      ? `\`{...${spread}}\` means every prop of \`${spread}\`; props written after it replace those.`
      : null,
    "A tag shown with `…` inside takes nested content; other tags are self-closing.",
  ];
  const lines = ["## Components", legend.filter(Boolean).join(" ")];
  const line = ({ signature, description }: ComponentPromptSpec) =>
    `- \`${signature}\`${description ? `: ${description}` : ""}`;
  const listed = new Set<string>();
  for (const group of spec.componentGroups ?? []) {
    lines.push("", `### ${group.name}`);
    for (const name of group.components) {
      if (listed.has(name) || !spec.components[name]) continue;
      listed.add(name);
      lines.push(line(spec.components[name]));
    }
    for (const note of group.notes ?? []) lines.push(note);
  }
  const rest = Object.entries(spec.components).filter(([name]) => !listed.has(name));
  if (rest.length) lines.push("", ...(listed.size ? ["### Other"] : []));
  for (const [, component] of rest) lines.push(line(component));
  const types = Object.entries(spec.types ?? {});
  if (types.length) lines.push("", "### Types", ...types.map(([n, t]) => `- \`${n} = ${t}\``));
  return lines.join("\n");
}

function actionsSection(actions: ActionSpec[]): string {
  return [
    "## Actions",
    `Call \`${ACTION_FUNCTION}(name, ...args)\` in an event handler to ask the app to do something:`,
    ...actions.map(
      (a) =>
        `- \`${ACTION_FUNCTION}("${a.name}"${a.params ? `, ${a.params}` : ""})\`: ${a.description}`,
    ),
  ].join("\n");
}
