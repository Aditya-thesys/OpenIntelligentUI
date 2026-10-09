import { compile, type CompileOptions } from "../../compiler";
import { createEngine, TEXT_NODE, type Batch, type EngineHost } from "../engine";

export interface TreeNode {
  type: string;
  text?: string;
  props: Record<string, unknown>;
  children: number[];
}

/** Applies the batches' operations, like a renderer would, and returns the resulting tree. */
export function applyBatches(batches: Batch[]) {
  const nodes = new Map<number, TreeNode>();
  const root: number[] = [];
  const parentOf = new Map<number, number>();
  const list = (parent: number) => (parent === 0 ? root : (nodes.get(parent)?.children ?? []));
  const detach = (id: number) => {
    const parent = parentOf.get(id);
    if (parent === undefined) return;
    const siblings = list(parent);
    siblings.splice(siblings.indexOf(id), 1);
    parentOf.delete(id);
  };
  for (const { ops } of batches)
    for (const op of ops) {
      const node = nodes.get(op.id);
      if (op.op === "create") nodes.set(op.id, { type: op.type, props: {}, children: [] });
      else if (op.op === "createText")
        nodes.set(op.id, { type: TEXT_NODE, text: op.text, props: {}, children: [] });
      else if (op.op === "set" && node) node.props[op.name] = op.value;
      else if (op.op === "unset" && node) delete node.props[op.name];
      else if (op.op === "text" && node) node.text = op.text;
      else if (op.op === "place") {
        detach(op.id);
        list(op.parent).splice(op.index, 0, op.id);
        parentOf.set(op.id, op.parent);
      } else if (op.op === "destroy") {
        detach(op.id);
        nodes.delete(op.id);
      }
    }
  const print = (id: number): string => {
    const n = nodes.get(id);
    if (!n) return "?";
    return n.type === TEXT_NODE
      ? JSON.stringify(n.text)
      : `${n.type}(${n.children.map(print).join(",")})`;
  };
  return { nodes, text: root.map(print).join(",") };
}

/** An engine that runs microtasks synchronously and records every batch. */
export function testEngine(host: Partial<EngineHost> = {}) {
  const batches: Batch[] = [];
  const persisted: Record<string, unknown>[] = [];
  const engine = createEngine({
    emit: (b) => batches.push(b),
    persistState: (s) => persisted.push(s),
    queueMicrotask: (fn) => fn(),
    ...host,
  });
  const load = (src: string, options?: CompileOptions) => {
    const out = compile(src, options);
    engine.load({ code: out.code, constants: out.constants });
  };
  const update = (src: string, options?: CompileOptions) => {
    const out = compile(src, options);
    engine.update({ code: out.code, constants: out.constants });
  };
  return { engine, batches, persisted, load, update, last: () => batches[batches.length - 1] };
}
