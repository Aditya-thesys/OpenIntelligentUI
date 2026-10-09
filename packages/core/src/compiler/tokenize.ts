import { MARKDOWN_TAGS } from "./language";
import { IDENT, partialArray, scanBraced, stripComments, WORD } from "./scan";
import type { DiagnosticCode } from "./types";

export type Attr = [name: string, kind: "str" | "expr" | "bool", value: string | true];

export type Token =
  | { kind: "text"; value: string }
  | { kind: "body"; value: string; pos: number }
  | { kind: "expr"; value: string }
  | { kind: "each"; list: string; params: string; pos: number }
  | { kind: "if"; cond: string; pos: number }
  | { kind: "elseif"; cond: string }
  | { kind: "else" }
  | { kind: "endeach" }
  | { kind: "endif" }
  | { kind: "open"; tag: string; attrs: Attr[]; selfClose: boolean; pos: number }
  | { kind: "close"; tag: string };

export interface Stop {
  code: DiagnosticCode;
  pos: number;
  name?: string;
}

export interface Tokens {
  tokens: Token[];
  stop: Stop | null;
  unknownDirectives: { pos: number; name?: string }[];
  partialName: string | null;
}

// The `(key)` of `{#each list as item, i (key)}` is ignored: rows carry their own `key`.
const PARAM = `(?:${IDENT}+|\\{[^{}]*\\}|\\[[^\\[\\]]*\\])`;
const EACH = new RegExp(
  `^#each\\s+([\\s\\S]+)\\s+as\\s+(${PARAM}(?:\\s*,\\s*${IDENT}+)?)\\s*(?:\\([\\s\\S]*\\))?\\s*$`,
  "u",
);
const TAG = new RegExp(`<([a-zA-Z](?:${WORD}|-)*)`, "uy");
const ATTR = new RegExp(`(?:${WORD}|[:-])+`, "uy");
const PARTIAL_DECL = new RegExp(`^@body\\s+(?:const|let|var)\\s+(${IDENT}+)\\s*=\\s*(?=\\[)`, "u");

const isLetter = (c: string | undefined) => !!c && /^\p{L}$/u.test(c);
const directiveName = (inner: string) => /^[@#:/](\w+)/.exec(inner)?.[1];
const atLineStart = (src: string, i: number) => /(^|\n)[ \t]*$/.test(src.slice(0, i));

export function tokenize(
  src: string,
  progressive = false,
  components?: ReadonlySet<string>,
): Tokens {
  const tokens: Token[] = [];
  const unknownDirectives: Tokens["unknownDirectives"] = [];
  let partialName: string | null = null;
  let stop: Stop | null = null;
  let text = "";
  let i = 0;
  const n = src.length;
  const flush = () => {
    if (text) tokens.push({ kind: "text", value: text });
    text = "";
  };

  while (i < n) {
    const c = src[i];
    if (c === "{") {
      const end = scanBraced(src, i);
      if (end === null) {
        const inner = src.slice(i + 1);
        stop = { code: "unterminated-braced-value", pos: i, name: directiveName(inner) };
        const decl = progressive ? PARTIAL_DECL.exec(inner) : null;
        const items = decl ? partialArray(inner.slice(decl[0].length)) : null;
        if (decl && items) {
          tokens.push({ kind: "body", value: `const ${decl[1]} = ${items}`, pos: i });
          partialName = decl[1];
        }
        break;
      }
      flush();
      const inner = stripComments(src.slice(i + 1, end - 1));
      // `{}` and `{/* note */}` render nothing.
      if (!inner.trim()) {
        i = end;
        continue;
      }
      const token = blockToken(inner, i);
      if (token) tokens.push(token);
      else unknownDirectives.push({ pos: i, name: directiveName(src.slice(i + 1)) });
      i = end;
      continue;
    }
    // Markdown code is literal: braces and tags inside it are text.
    if (c === "`" && src.startsWith("```", i) && atLineStart(src, i)) {
      const head = src.indexOf("\n", i);
      if (head < 0) break;
      // A fence indented under a list item closes at the same indent; its lines lose it.
      const indent = i - src.lastIndexOf("\n", i - 1) - 1;
      const fence = /\n[ \t]*```/g;
      fence.lastIndex = head;
      const close = fence.exec(src);
      const code = src.slice(head + 1, close ? close.index : n);
      const attrs: Attr[] = [
        ["code", "str", indent ? code.replace(new RegExp(`^[ \\t]{0,${indent}}`, "gm"), "") : code],
      ];
      const language = src.slice(i + 3, head).trim();
      if (language) attrs.push(["language", "str", language]);
      flush();
      tokens.push({ kind: "open", tag: MARKDOWN_TAGS.codeBlock, attrs, selfClose: true, pos: i });
      const after = close ? src.indexOf("\n", fence.lastIndex) : -1;
      i = after < 0 ? n : after;
      continue;
    }
    if (c === "`") {
      const run = /`+/y;
      run.lastIndex = i;
      const ticks = run.exec(src)![0];
      const close = src.indexOf(ticks, i + ticks.length);
      const literal = close >= 0 && !src.slice(i, close).includes("\n\n");
      const end = literal ? close + ticks.length : i + ticks.length;
      text += src.slice(i, end);
      i = end;
      continue;
    }
    if (c === "<" && i + 1 >= n) {
      stop = { code: "unterminated-tag", pos: i };
      break;
    }
    if (c === "<" && src[i + 1] === "/") {
      const end = src.indexOf(">", i);
      if (end < 0) {
        stop = { code: "unterminated-tag", pos: i };
        break;
      }
      flush();
      tokens.push({ kind: "close", tag: src.slice(i + 2, end).trim() });
      i = end + 1;
      continue;
    }
    if (c === "<" && isLetter(src[i + 1])) {
      TAG.lastIndex = i;
      const m = TAG.exec(src);
      const tag = m ? readTag(src, TAG.lastIndex) : null;
      if (m && tag && !tag.done) {
        stop = { code: "unterminated-tag", pos: i };
        // A capitalized component that is still being written renders with its finished
        // attributes (and the complete items of an array attribute); lowercase elements wait.
        if (progressive && /^[A-Z]/.test(m[1])) {
          const items = tag.pending ? partialArray(tag.pending.value) : null;
          if (tag.pending && items) tag.attrs.push([tag.pending.name, "expr", items]);
          flush();
          tokens.push({ kind: "open", tag: m[1], attrs: tag.attrs, selfClose: true, pos: i });
        }
        break;
      }
      // `Press <Enter>` or `List<User>` in prose: an unknown component that is never closed.
      const prose =
        m &&
        tag &&
        components &&
        /^[A-Z]/.test(m[1]) &&
        !components.has(m[1]) &&
        !tag.selfClose &&
        !src.includes(`</${m[1]}`, tag.end);
      if (m && tag && !prose) {
        flush();
        tokens.push({
          kind: "open",
          tag: m[1],
          attrs: tag.attrs,
          selfClose: tag.selfClose,
          pos: i,
        });
        i = tag.end;
        continue;
      }
      // Not a tag (`a<b` in prose): the `<` is text.
    }
    text += c;
    i++;
  }
  flush();
  return { tokens, stop, unknownDirectives, partialName };
}

function blockToken(inner: string, pos: number): Token | null {
  if (inner.startsWith("@body")) return { kind: "body", value: inner.slice(5).trim(), pos };
  const each = inner.startsWith("#each") ? EACH.exec(inner) : null;
  if (each) return { kind: "each", list: each[1].trim(), params: each[2].trim(), pos };
  if (inner.startsWith("#if")) return { kind: "if", cond: inner.slice(3).trim(), pos };
  const elseIf = /^:else\s*if\b/.exec(inner);
  if (elseIf) return { kind: "elseif", cond: inner.slice(elseIf[0].length).trim() };
  if (/^:else\s*$/.test(inner)) return { kind: "else" };
  if (/^\/each\s*$/.test(inner)) return { kind: "endeach" };
  if (/^\/if\s*$/.test(inner)) return { kind: "endif" };
  // Emitting an unknown directive as an expression would make the whole program fail to parse.
  if (/^[@#:/][A-Za-z]/.test(inner)) return null;
  // `{a: 1}` is object notation in prose, not an expression (it would parse as a label).
  if (new RegExp(`^\\s*${IDENT}+\\s*:(?!:)`, "u").test(inner))
    return { kind: "text", value: `{${inner}}` };
  return { kind: "expr", value: inner };
}

interface TagRead {
  attrs: Attr[];
  done: boolean;
  selfClose: boolean;
  end: number;
  pending?: { name: string; value: string };
}

function readTag(src: string, start: number): TagRead | null {
  const attrs: Attr[] = [];
  const n = src.length;
  const cut: TagRead = { attrs, done: false, selfClose: false, end: n };
  let j = start;
  while (j < n) {
    while (j < n && /\s/u.test(src[j])) j++;
    if (j >= n) return cut;
    if (src.startsWith("/>", j)) return { attrs, done: true, selfClose: true, end: j + 2 };
    if (src[j] === ">") return { attrs, done: true, selfClose: false, end: j + 1 };
    if (src[j] === "/" && j + 1 >= n) return cut;
    ATTR.lastIndex = j;
    const m = ATTR.exec(src);
    if (!m) return null;
    const name = m[0];
    j += name.length;
    if (j >= n) return cut;
    if (src[j] !== "=") {
      attrs.push([name, "bool", true]);
      continue;
    }
    j++;
    const quote = src[j];
    if (quote === '"' || quote === "'") {
      const close = src.indexOf(quote, j + 1);
      if (close < 0) return cut;
      attrs.push([name, "str", src.slice(j + 1, close)]);
      j = close + 1;
    } else if (quote === "{") {
      const close = scanBraced(src, j);
      if (close === null) return { ...cut, pending: { name, value: src.slice(j + 1) } };
      attrs.push([name, "expr", stripComments(src.slice(j + 1, close - 1))]);
      j = close;
    } else return j >= n ? cut : null;
  }
  return cut;
}
