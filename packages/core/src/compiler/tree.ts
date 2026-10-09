import type { Attr, Token } from "./tokenize";

export type Node =
  { kind: "text"; value: string } | { kind: "expr"; value: string } | Element | Each | If;

export interface Element {
  kind: "el";
  tag: string;
  attrs: Attr[];
  children: Node[];
  closed: boolean;
}

interface Each {
  kind: "each";
  list: string;
  params: string;
  children: Node[];
  closed: boolean;
  pos: number;
}

interface If {
  kind: "if";
  branches: [cond: string | null, children: Node[]][];
  closed: boolean;
  pos: number;
}

type Container = Element | Each | If | { kind: "root"; children: Node[] };

export const textNode = (value: string): Node => ({ kind: "text", value });

export const element = (tag: string, children: Node[], attrs: Attr[] = []): Element => ({
  kind: "el",
  tag,
  attrs,
  children,
  closed: true,
});

export interface Body {
  value: string;
  pos: number;
}

export interface Tree {
  children: Node[];
  bodies: Body[];
  nestedBodies: Body[];
  openBlocks: (Each | If)[];
  /** Where the first element or block past MAX_DEPTH was dropped. */
  tooDeep: number | null;
}

// Code generation recurses per level; a hostile answer nested thousands deep would overflow it.
const MAX_DEPTH = 100;

export function buildTree(tokens: Token[]): Tree {
  const root: Container = { kind: "root", children: [] };
  const stack: Container[] = [root];
  const bodies: Body[] = [];
  const nestedBodies: Body[] = [];
  // Dropped opens, by tag (`#each`, `#if` for blocks), so their closes are dropped too.
  const dropped = new Map<string, number>();
  let tooDeep: number | null = null;
  const drop = (key: string, pos: number) => {
    if (stack.length <= MAX_DEPTH) return false;
    dropped.set(key, (dropped.get(key) ?? 0) + 1);
    tooDeep ??= pos;
    return true;
  };
  const undrop = (key: string) => {
    const n = dropped.get(key);
    if (n) dropped.set(key, n - 1);
    return !!n;
  };
  const add = (node: Node) => {
    const top = stack[stack.length - 1];
    if (top.kind === "if") top.branches[top.branches.length - 1][1].push(node);
    else top.children.push(node);
  };
  const closeNearest = (match: (node: Container) => boolean) => {
    for (let k = stack.length - 1; k > 0; k--) {
      const node = stack[k];
      if (node.kind !== "root" && match(node)) {
        node.closed = true;
        stack.length = k;
        return;
      }
    }
  };

  for (const t of tokens) {
    switch (t.kind) {
      case "body": {
        const inBlock = stack.some((s) => s.kind === "each" || s.kind === "if");
        (inBlock ? nestedBodies : bodies).push({ value: t.value, pos: t.pos });
        break;
      }
      case "text":
      case "expr":
        add({ kind: t.kind, value: t.value });
        break;
      case "open": {
        if (!t.selfClose && drop(t.tag, t.pos)) break;
        const el: Element = { ...element(t.tag, [], t.attrs), closed: t.selfClose };
        add(el);
        if (!t.selfClose) stack.push(el);
        break;
      }
      case "close":
        if (undrop(t.tag)) break;
        closeNearest((node) => node.kind === "el" && node.tag === t.tag);
        break;
      case "each":
      case "if": {
        if (drop(`#${t.kind}`, t.pos)) break;
        const block: Each | If =
          t.kind === "each"
            ? {
                kind: "each",
                list: t.list,
                params: t.params,
                children: [],
                closed: false,
                pos: t.pos,
              }
            : { kind: "if", branches: [[t.cond, []]], closed: false, pos: t.pos };
        add(block);
        stack.push(block);
        break;
      }
      case "elseif":
      case "else":
        for (let k = stack.length - 1; k > 0; k--) {
          const block = stack[k];
          if (block.kind === "if") {
            stack.length = k + 1;
            block.branches.push([t.kind === "elseif" ? t.cond : null, []]);
            break;
          }
        }
        break;
      case "endeach":
        if (undrop("#each")) break;
        closeNearest((node) => node.kind === "each");
        break;
      case "endif":
        if (undrop("#if")) break;
        closeNearest((node) => node.kind === "if");
        break;
    }
  }
  const openBlocks = stack.filter(
    (s): s is Each | If => (s.kind === "each" || s.kind === "if") && !s.closed,
  );
  return { children: root.children, bodies, nestedBodies, openBlocks, tooDeep };
}
