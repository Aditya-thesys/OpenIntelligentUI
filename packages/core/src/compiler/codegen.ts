import { INLINE_TAGS, INTERNAL, MARKDOWN_TAGS as MD } from "./language";
import { WORD } from "./scan";
import type { Attr } from "./tokenize";
import { element, textNode, type Element, type Node } from "./tree";

const { jsx: JSX, safe: SAFE, need: NEED, constants: CONSTANTS } = INTERNAL;

const HEADING = /^(#{1,6})\s+/u;
const HEADING_SIZE: Record<number, string> = { 1: "xl", 2: "lg", 3: "md" };
const LIST_ITEM = /^([-*+]|\d{1,9}[.)])\s+/u;
const RULE = /^(?:-{3,}|\*{3,}|_{3,})$/u;
const TABLE_DIVIDER = /^\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?$/u;
const CODE_SPAN = /(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/u;
const LINK = /\[([^\]]+)\]\(((?:[^()\s]|\([^()\s]*\))+)\)/u;
const ESCAPE = /\\([!-/:-@[-`{-~])/u;

const quoteKeys = (v: string) =>
  v.replace(new RegExp(`([{,]\\s*)([A-Za-z_$](?:${WORD}|\\$)*)\\s*:`, "gu"), '$1"$2":');

const SAFE_HELPER = `function ${SAFE}(evaluate,fallback){try{return evaluate()}catch{return fallback}}\n`;
// Once the answer is complete, a name that was never declared is reported, not just skipped.
const REPORTING_SAFE_HELPER = `function ${SAFE}(evaluate,fallback){try{return evaluate()}catch(e){${JSX}.undefinedName(e);return fallback}}\n`;
const NEED_HELPER = `function ${NEED}(evaluate){const value=evaluate();if(value===undefined)throw 0;return value}\n`;

type Line = Node[];

const leadText = (line: Line) => (line[0]?.kind === "text" ? line[0].value : "");
const isBlank = (line: Line) => line.every((n) => n.kind === "text" && !n.value.trim());
const hasPipe = (line: Line) => line.some((n) => n.kind === "text" && n.value.includes("|"));
const isDivider = (line: Line | undefined) =>
  !!line && line.length === 1 && hasPipe(line) && TABLE_DIVIDER.test(leadText(line).trim());

function trimLead(line: Line, cut = 0): Line {
  if (line[0]?.kind !== "text") return line;
  const value = line[0].value.replace(/^\s+/u, "").slice(cut);
  return value ? [textNode(value), ...line.slice(1)] : line.slice(1);
}

function splitLines(nodes: Node[]): Line[] {
  const lines: Line[] = [[]];
  for (const node of nodes) {
    if (node.kind !== "text") {
      lines[lines.length - 1].push(node);
      continue;
    }
    node.value.split("\n").forEach((segment, i) => {
      if (i > 0) lines.push([]);
      if (segment) lines[lines.length - 1].push(textNode(segment));
    });
  }
  return lines;
}

const indentOf = (line: Line) => /^[ \t]*/u.exec(leadText(line))![0].replace(/\t/g, "    ").length;

function joinLines(lines: Line[]): Node[] {
  const out: Node[] = [];
  lines.forEach((line, i) => {
    for (const node of i > 0 ? [textNode("\n"), ...line] : line) {
      const last = out[out.length - 1];
      if (node.kind === "text" && last?.kind === "text")
        out[out.length - 1] = textNode(last.value + node.value);
      else out.push(node);
    }
  });
  return out;
}

function tableCells(line: Line): Line[] {
  const cells: Line[] = [[]];
  for (const node of line) {
    if (node.kind !== "text") {
      cells[cells.length - 1].push(node);
      continue;
    }
    node.value.split("|").forEach((part, i) => {
      if (i > 0) cells.push([]);
      if (part) cells[cells.length - 1].push(textNode(part));
    });
  }
  const last = line[line.length - 1];
  if (leadText(line).startsWith("|")) cells.shift();
  if (last?.kind === "text" && last.value.trimEnd().endsWith("|")) cells.pop();
  return cells;
}

// Every expression is wrapped so a failing value renders as its fallback instead of throwing.
export class CodeGen {
  readonly constants: Record<string, unknown> = {};
  private usedSafe = false;
  private usedNeed = false;
  private holding = false;
  private count = 0;
  // Blocks that render nothing yet (an `each` or `if` without content).
  private readonly hollow = new Set<string>();

  constructor(private readonly progressive: boolean) {}

  guard(code: string, fallback: string): string {
    this.usedSafe = true;
    return `${SAFE}(()=>(${code}),${fallback})`;
  }

  private need(code: string): string {
    this.usedNeed = true;
    return `${NEED}(()=>(${code}))`;
  }

  prelude(): string {
    const safe = this.progressive ? SAFE_HELPER : REPORTING_SAFE_HELPER;
    const helpers = (this.usedSafe ? safe : "") + (this.usedNeed ? NEED_HELPER : "");
    return helpers && helpers + "\n";
  }

  children(nodes: Node[], inline: boolean): string[] {
    if (inline) return compact(this.inline(nodes).map((child) => this.node(child)));
    const out: (string | null)[] = [];
    let run: Node[] = [];
    const flushRun = () => {
      if (run.length) out.push(...this.blocks(run));
      run = [];
    };
    nodes.forEach((child, k) => {
      if (child.kind === "text" || child.kind === "expr" || inSentence(nodes, k)) run.push(child);
      else {
        flushRun();
        out.push(this.node(child));
      }
    });
    flushRun();
    return compact(out);
  }

  private constant(value: unknown): string {
    const key = String(this.count++);
    this.constants[key] = value;
    return `${CONSTANTS}["${key}"]`;
  }

  private blocks(nodes: Node[]): (string | null)[] {
    const raw = splitLines(nodes);
    const lines = raw.map((line) => trimLead(line));
    const indents = raw.map(indentOf);
    const out: (string | null)[] = [];
    let paragraph: Line[] = [];
    const endParagraph = () => {
      if (paragraph.length) out.push(this.node(element(MD.paragraph, joinLines(paragraph))));
      paragraph = [];
    };
    const block = (el: Element) => {
      endParagraph();
      out.push(this.node(el));
    };
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lead = leadText(line);
      const heading = HEADING.exec(lead);
      if (isBlank(line)) endParagraph();
      else if (heading) {
        const size = HEADING_SIZE[heading[1].length] ?? "sm";
        block(element(MD.heading, trimLead(line, heading[0].length), [["size", "str", size]]));
      } else if (line.length === 1 && RULE.test(lead.trim())) block(element(MD.rule, []));
      else if (hasPipe(line) && isDivider(lines[i + 1])) {
        const rows = [line];
        for (i += 2; i < lines.length && hasPipe(lines[i]) && !isBlank(lines[i]); i++)
          rows.push(lines[i]);
        i--;
        block(this.table(rows));
      } else if (LIST_ITEM.test(lead)) {
        const [list, next] = this.list(lines, indents, i);
        i = next - 1;
        block(list);
      } else paragraph.push(line);
    }
    endParagraph();
    return out;
  }

  // A list from line `i`; an item's lines indented past its marker hold its nested lists.
  private list(lines: Line[], indents: number[], i: number): [Element, number] {
    const base = indents[i];
    const first = LIST_ITEM.exec(leadText(lines[i]))![1];
    const ordered = /\d/.test(first);
    const items: { lines: Line[]; nested: Element[] }[] = [];
    for (; i < lines.length; i++) {
      const marker = LIST_ITEM.exec(leadText(lines[i]));
      if (marker && indents[i] > base && items.length) {
        const [nested, next] = this.list(lines, indents, i);
        items[items.length - 1].nested.push(nested);
        i = next - 1;
      } else if (marker && indents[i] < base) break;
      else if (marker && /\d/.test(marker[1]) === ordered)
        items.push({ lines: [trimLead(lines[i], marker[0].length)], nested: [] });
      else if (marker || HEADING.test(leadText(lines[i]))) break;
      else if (!isBlank(lines[i])) items[items.length - 1].lines.push(lines[i]);
      // A blank line ends the list unless another item of it follows.
      else if (!LIST_ITEM.test(leadText(lines[i + 1] ?? []))) break;
    }
    const attrs: Attr[] = ordered ? [["ordered", "bool", true]] : [];
    // A list resumed after a code block keeps its numbering.
    if (ordered && parseInt(first) !== 1) attrs.push(["start", "expr", String(parseInt(first))]);
    const list = items.map((item) =>
      element(MD.listItem, [...joinLines(item.lines), ...item.nested]),
    );
    return [element(MD.list, list, attrs), i];
  }

  private inline(nodes: Node[]): Node[] {
    const seq = nodes.filter(
      (n) => !(n.kind === "text" && n.value.trim() === "" && n.value.includes("\n")),
    );
    const first = seq[0];
    if (first?.kind === "text") seq[0] = textNode(first.value.replace(/^\s+/u, ""));
    const last = seq[seq.length - 1];
    if (last?.kind === "text") seq[seq.length - 1] = textNode(last.value.replace(/\s+$/u, ""));
    const items: Node[] = [];
    let target = items;
    let bold: Element | null = null;
    const markup = (text: string) => {
      for (const part of text.split(/(\*\*)/)) {
        if (part === "**") {
          bold = bold ? null : element(MD.bold, []);
          if (bold) items.push(bold);
          target = bold ? bold.children : items;
        } else if (part) {
          // Italics only when the asterisks hug a word, so math like 2*3*4 stays text.
          const pieces = part.split(/(?<=^|[\s(])\*([^\s*](?:[^*]*[^\s*])?)\*(?=[\s.,;:!?)]|$)/u);
          pieces.forEach((piece, k) => {
            if (k % 2 === 1) target.push(element(MD.italic, [textNode(piece)]));
            else if (piece) target.push(textNode(piece));
          });
        }
      }
    };
    // A backslash makes the next punctuation character literal: `\*` is an asterisk.
    const emphasis = (text: string) =>
      text.split(ESCAPE).forEach((part, k) => {
        if (k % 2 === 0) markup(part);
        else target.push(textNode(part));
      });
    for (const node of seq) {
      if (node.kind !== "text") {
        target.push(node);
        continue;
      }
      let rest = node.value.replace(/\s*\n\s*/gu, " ");
      while (rest) {
        const code = CODE_SPAN.exec(rest);
        const link = LINK.exec(rest);
        const next = code && (!link || code.index <= link.index) ? code : link;
        if (!next) break;
        emphasis(rest.slice(0, next.index));
        if (next === code) target.push(element(MD.code, [textNode(code[2].trim() || code[2])]));
        else target.push(element(MD.link, [textNode(next[1])], [["href", "str", next[2]]]));
        rest = rest.slice(next.index + next[0].length);
      }
      emphasis(rest);
    }
    return items;
  }

  private table(rows: Line[]): Element {
    return element(
      MD.table,
      rows.map((row, r) =>
        element(
          MD.tableRow,
          tableCells(row).map((cell) =>
            element(
              MD.tableCell,
              [element(MD.paragraph, cell)],
              r === 0 ? [["header", "bool", true]] : [],
            ),
          ),
        ),
      ),
    );
  }

  fragment(children: string[]): string {
    if (children.length === 1) return children[0];
    return children.length ? `${JSX}.jsx(${JSX}.Fragment,null,${children.join(",")})` : "null";
  }

  private node(node: Node): string | null {
    switch (node.kind) {
      case "text":
        return node.value ? this.constant(node.value) : null;
      case "expr":
        return this.holding ? this.need(node.value) : this.guard(node.value, "null");
      case "each": {
        const body = this.children(node.children, false);
        const map = `(${node.list}).map((${node.params})=>${this.guard(this.fragment(body), "null")})`;
        const out = this.guard(map, "[]");
        if (!body.length) this.hollow.add(out);
        return out;
      }
      case "if":
        return this.conditional(node.branches);
      case "el":
        return this.element(node);
    }
  }

  private conditional(branches: [cond: string | null, children: Node[]][]): string {
    const parts = branches.map(
      ([cond, kids]) => [cond, this.fragment(this.children(kids, false))] as const,
    );
    let out = "";
    let hasElse = false;
    for (const [cond, body] of parts) {
      if (cond === null) {
        out += body;
        hasElse = true;
        break;
      }
      // While streaming, a condition that fails (often on a list not written yet) shows no
      // branch, rather than the else branch for a moment.
      out += `(${this.progressive ? cond : this.guard(cond, "false")})?${body}:`;
    }
    if (!hasElse) out += "null";
    if (this.progressive) out = this.guard(out, "null");
    if (parts.every(([, body]) => body === "null")) this.hollow.add(out);
    return out;
  }

  private element(node: Element): string | null {
    const { tag } = node;
    const props: string[] = [];
    let dynamic = false;
    for (const [name, kind, value] of node.attrs) {
      if (kind === "bool") props.push(`"${name}":true`);
      else if (kind === "str") props.push(`"${name}":${JSON.stringify(value)}`);
      else {
        const prop = this.exprProp(String(value).trim());
        dynamic ||= prop.dynamic;
        props.push(`"${name}":${prop.code}`);
      }
    }
    const inline = INLINE_TAGS.has(tag);
    // While streaming, a sentence such as "grows to {total}" waits until every value in it
    // exists, instead of showing with a gap where a value not yet written would go.
    const nested = this.holding;
    const holdHere = this.progressive && inline && !nested && hasExpr(node.children);
    const kidNodes = node.children.filter(
      (c) => !(c.kind === "text" && !c.value.trim() && (c.value.includes("\n") || !inline)),
    );
    let kids: string[];
    let wrap = dynamic || holdHere;
    this.holding ||= holdHere;
    try {
      if (kidNodes.length === 1 && kidNodes[0].kind === "expr") {
        const value = kidNodes[0].value.trim();
        kids = [this.holding ? this.need(value) : value];
        wrap = true;
      } else {
        kids = this.children(node.children, inline);
        if (!node.closed && kids.every((k) => this.hollow.has(k))) return null;
      }
    } finally {
      if (holdHere) this.holding = false;
    }
    const code = `${JSX}.jsx(${JSON.stringify(tag)},${props.length ? `{${props.join(",")}}` : "null"}${kids.length ? "," + kids.join(",") : ""})`;
    return wrap && !nested ? this.guard(code, "null") : code;
  }

  private exprProp(value: string): { code: string; dynamic: boolean } {
    let literal: unknown;
    try {
      literal = JSON.parse("[{".includes(value[0] ?? "") ? quoteKeys(value) : value);
    } catch {
      return { code: value, dynamic: true };
    }
    if (typeof literal === "string" || (typeof literal === "object" && literal !== null))
      return { code: this.constant(literal), dynamic: false };
    return { code: value, dynamic: false };
  }
}

const PHRASING = new Set(
  [...INLINE_TAGS].filter((t) => t !== MD.paragraph && t !== MD.heading && t !== MD.listItem),
);

// An inline element on a line with text, as in "Status: <badge>new</badge> today", stays in
// the sentence instead of becoming a block of its own.
function inSentence(nodes: Node[], k: number): boolean {
  const node = nodes[k];
  if (node.kind !== "el" || !PHRASING.has(node.tag)) return false;
  const hugs = (n: Node | undefined, side: "before" | "after") => {
    if (n?.kind === "expr") return true;
    if (n?.kind !== "text") return false;
    const lines = n.value.split("\n");
    return /\S/u.test(side === "before" ? lines[lines.length - 1] : lines[0]);
  };
  return hugs(nodes[k - 1], "before") || hugs(nodes[k + 1], "after");
}

const compact = (items: (string | null)[]) => items.filter((s): s is string => s !== null);

const hasExpr = (nodes: Node[]): boolean =>
  nodes.some(
    (n) =>
      n.kind === "expr" ||
      (n.kind === "el" && hasExpr(n.children)) ||
      (n.kind === "each" && hasExpr(n.children)) ||
      (n.kind === "if" && n.branches.some(([, kids]) => hasExpr(kids))),
  );
