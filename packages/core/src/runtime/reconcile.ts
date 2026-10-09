import { Fragment, isElement, type ComponentFn } from "./element";
import { ROOT, type Components } from "./hooks";

export type NodeId = number;

/** The `type` of a text node, on both sides of the wire. */
export const TEXT_NODE = "#text";

export type Op =
  | { op: "create"; id: NodeId; type: string }
  | { op: "createText"; id: NodeId; text: string }
  | { op: "place"; id: NodeId; parent: NodeId; index: number }
  | { op: "set"; id: NodeId; name: string; value: unknown }
  | { op: "unset"; id: NodeId; name: string }
  | { op: "text"; id: NodeId; text: string }
  | { op: "destroy"; id: NodeId };

// In props, functions travel as `{ $fn: slot }` and elements as `{ $el }`. Program data keys
// starting with `$` get one more `$`, so data can never pose as these markers.
export interface EncodedElement {
  type: string;
  props: Record<string, unknown>;
  children: unknown[];
}

type Handler = (...args: unknown[]) => unknown;

type VNode =
  | { kind: "text"; text: string }
  | {
      kind: "host";
      type: string;
      key: string | null;
      props: Record<string, unknown>;
      children: VNode[];
    };

interface HNode {
  id: NodeId;
  type: string;
  key: string | null;
  text?: string;
  props: Record<string, unknown>;
  children: HNode[];
}

const MAX_ENCODE_DEPTH = 32;
// What one commit may send: one per node and encoded value, plus one per 64 characters of text.
const OUTPUT_BUDGET = 100_000;

const same = (a: unknown, b: unknown): boolean => {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || typeof b !== "object" || !a || !b) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every((k) =>
    same((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
  );
};

/**
 * Turns a rendered element tree into operations on the page's copy of it. Handlers stay here,
 * in `handlers`, and travel as slot names.
 */
export class Reconciler {
  handlers = new Map<string, Handler>();
  private committed: HNode[] = [];
  private nextId = 1;
  private budget = OUTPUT_BUDGET;

  constructor(private readonly components: Components) {}

  render(root: ComponentFn): VNode[] {
    this.components.beginPass();
    const out: VNode[] = [];
    this.expand(this.components.render(root, {}, ROOT), ROOT, out);
    return out;
  }

  /**
   * Operations that turn the committed tree into `tree`. Components inside props render here.
   * Nodes are copied, not changed, so a diff that throws leaves the committed tree as it was.
   */
  diff(tree: VNode[]): Op[] {
    const ops: Op[] = [];
    const previous = this.handlers;
    this.handlers = new Map();
    this.budget = OUTPUT_BUDGET;
    try {
      this.committed = this.reconcile(0, this.committed, tree, ops);
    } catch (e) {
      this.handlers = previous;
      throw e;
    }
    return ops;
  }

  private expand(value: unknown, path: string, out: VNode[]) {
    if (value === null || value === undefined || typeof value === "boolean") return;
    if (Array.isArray(value)) {
      value.forEach((v, i) => this.expand(v, `${path}.${i}`, out));
      return;
    }
    if (typeof value === "string" || typeof value === "number" || typeof value === "bigint") {
      const text = String(value);
      const last = out[out.length - 1];
      if (last && last.kind === "text") last.text += text;
      else out.push({ kind: "text", text });
      return;
    }
    if (!isElement(value)) {
      out.push({ kind: "text", text: String(value) });
      return;
    }
    const { type, props, key } = value;
    const here = `${path}${key !== null ? `#${key}` : ""}`;
    if (type === Fragment) {
      this.expand(props.children, here, out);
      return;
    }
    if (typeof type === "function") {
      const rendered = this.components.render(type, props, `${here}:${type.name || "c"}`);
      this.expand(rendered, here, out);
      return;
    }
    const children: VNode[] = [];
    this.expand(props.children, here, children);
    const rest = { ...props };
    delete rest.children;
    out.push({ kind: "host", type: String(type), key, props: rest, children });
  }

  private encode(value: unknown, slot: string, depth = 0): unknown {
    if (depth > MAX_ENCODE_DEPTH) return null;
    this.charge(typeof value === "string" ? value : null);
    if (typeof value === "function") {
      this.handlers.set(slot, value as Handler);
      return { $fn: slot };
    }
    if (value === undefined || value === null || typeof value !== "object") {
      if (typeof value === "number" && !Number.isFinite(value)) return null;
      return typeof value === "bigint" ? String(value) : value;
    }
    if (isElement(value)) {
      const vnodes: VNode[] = [];
      this.expand(value, slot, vnodes);
      return vnodes.map((v, i) => this.encodeVNode(v, `${slot}[${i}]`, depth + 1));
    }
    if (Array.isArray(value)) return value.map((v, i) => this.encode(v, `${slot}.${i}`, depth + 1));
    if (value instanceof Date) return value.toISOString();
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value))
      out[k.startsWith("$") ? `$${k}` : k] = this.encode(v, `${slot}.${k}`, depth + 1);
    return out;
  }

  private charge(text: string | null) {
    this.budget -= 1 + (text ? text.length >> 6 : 0);
    if (this.budget < 0) throw new Error("The rendered output is too large");
  }

  private encodeVNode(v: VNode, slot: string, depth: number): unknown {
    if (v.kind === "text") return v.text;
    const props: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v.props))
      props[k] = this.encode(val, `${slot}.${k}`, depth + 1);
    const children = v.children.map((c, i) => this.encodeVNode(c, `${slot}/${i}`, depth + 1));
    return { $el: { type: v.type, props, children } };
  }

  private create(v: VNode, ops: Op[]): HNode {
    const id = this.nextId++;
    if (v.kind === "text") {
      ops.push({ op: "createText", id, text: v.text });
      return { id, type: TEXT_NODE, key: null, text: v.text, props: {}, children: [] };
    }
    ops.push({ op: "create", id, type: v.type });
    const props: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v.props)) {
      props[k] = this.encode(val, `${id}.${k}`);
      if (props[k] !== undefined) ops.push({ op: "set", id, name: k, value: props[k] });
    }
    const node: HNode = { id, type: v.type, key: v.key, props, children: [] };
    node.children = this.reconcile(id, [], v.children, ops);
    return node;
  }

  private update(node: HNode, v: VNode, ops: Op[]): HNode {
    if (v.kind === "text") {
      if (node.text === v.text) return node;
      ops.push({ op: "text", id: node.id, text: v.text });
      return { ...node, text: v.text };
    }
    const next: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v.props)) next[k] = this.encode(val, `${node.id}.${k}`);
    for (const [k, val] of Object.entries(node.props))
      if (val !== undefined && next[k] === undefined)
        ops.push({ op: "unset", id: node.id, name: k });
    for (const [k, val] of Object.entries(next))
      if (val !== undefined && !same(node.props[k], val))
        ops.push({ op: "set", id: node.id, name: k, value: val });
    return {
      ...node,
      props: next,
      children: this.reconcile(node.id, node.children, v.children, ops),
    };
  }

  private reconcile(parent: NodeId, old: HNode[], next: VNode[], ops: Op[]): HNode[] {
    const keyed = new Map<string, HNode>();
    const unkeyed: HNode[] = [];
    for (const o of old) {
      if (o.key !== null) keyed.set(`${o.type}|${o.key}`, o);
      else unkeyed.push(o);
    }
    const used = new Set<HNode>();
    let u = 0;
    const matches = next.map((v) => {
      const type = v.kind === "text" ? TEXT_NODE : v.type;
      const key = v.kind === "host" ? v.key : null;
      let m: HNode | undefined;
      if (key !== null) m = keyed.get(`${type}|${key}`);
      else {
        const cand = unkeyed[u++];
        if (cand && cand.type === type) m = cand;
      }
      if (m && used.has(m)) m = undefined;
      if (m) used.add(m);
      return m;
    });
    // A destroyed node's descendants go with it on the page.
    for (const o of old) if (!used.has(o)) ops.push({ op: "destroy", id: o.id });
    const order = old.filter((o) => used.has(o)).map((o) => o.id);
    return next.map((v, i) => {
      this.charge(v.kind === "text" ? v.text : null);
      const match = matches[i];
      const node = match ? this.update(match, v, ops) : this.create(v, ops);
      if (order[i] !== node.id) {
        const at = order.indexOf(node.id);
        if (at >= 0) order.splice(at, 1);
        order.splice(i, 0, node.id);
        ops.push({ op: "place", id: node.id, parent, index: i });
      }
      return node;
    });
  }
}
