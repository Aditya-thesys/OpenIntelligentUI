/** Hooks programs call as plain functions, e.g. `const [n, setN] = useState(0)`. */
export const HOOKS = [
  "useState",
  "useEffect",
  "useMemo",
  "useCallback",
  "useRef",
  "useId",
  "useNow",
  "useTimeout",
  "useAppData",
] as const;

/** Function programs call to ask the app to act: `action("openUrl", url)`. */
export const ACTION_FUNCTION = "action";

/** Names compiled programs use internally. */
export const INTERNAL = {
  jsx: "__ui",
  safe: "__safe",
  need: "__need",
  constants: "__constants",
} as const;

/** Tags compiled Markdown produces; every library must define them. */
export const MARKDOWN_TAGS = {
  paragraph: "text",
  heading: "title",
  bold: "bold",
  italic: "italic",
  code: "code",
  codeBlock: "code-block",
  link: "link",
  list: "list",
  listItem: "list-item",
  rule: "divider",
  table: "table",
  tableRow: "table-row",
  tableCell: "table-cell",
} as const;

/** Tags whose text is inline: newlines collapse and Markdown emphasis applies. */
export const INLINE_TAGS: ReadonlySet<string> = new Set([
  "text",
  "title",
  "caption",
  "label",
  "badge",
  "button",
  "bold",
  "italic",
  "strike",
  "link",
  "code",
  "list-item",
  "svg-text",
]);
