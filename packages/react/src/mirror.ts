import { TEXT_NODE, type Op } from "@open-intelligent-ui/core";

export interface MirrorNode {
  id: number;
  type: string;
  text?: string;
  props: Record<string, unknown>;
  children: number[];
  born: number;
}

// Immutable updates (a changed node and its ancestors get new objects) let memoized renderers skip
// unchanged subtrees. Operations come from model-written code, so any that would break the tree
// (a second create, a missing parent, a cycle) are skipped.
export class Mirror {
  nodes = new Map<number, MirrorNode>();
  root: number[] = [];
  private parentOf = new Map<number, number>();
  // Nodes and child lists (0 is the root list) already copied in this apply(), so later
  // operations change them in place instead of copying again. A copied node's ancestors are too.
  private copied = new Set<number>();
  private ownLists = new Set<number>();

  apply(ops: Op[]) {
    this.copied.clear();
    this.ownLists.clear();
    for (const op of ops) {
      switch (op.op) {
        case "create":
          if (this.nodes.has(op.id)) break;
          this.nodes.set(op.id, {
            id: op.id,
            type: op.type,
            props: {},
            children: [],
            born: Date.now(),
          });
          break;
        case "createText":
          if (this.nodes.has(op.id)) break;
          this.nodes.set(op.id, {
            id: op.id,
            type: TEXT_NODE,
            text: op.text,
            props: {},
            children: [],
            born: Date.now(),
          });
          break;
        case "set":
          this.replace(op.id, (n) => ({ ...n, props: { ...n.props, [op.name]: op.value } }));
          break;
        case "unset":
          this.replace(op.id, (n) => {
            const props = { ...n.props };
            delete props[op.name];
            return { ...n, props };
          });
          break;
        case "text":
          this.replace(op.id, (n) => ({ ...n, text: op.text }));
          break;
        case "place": {
          if (!this.nodes.has(op.id) || !this.canPlace(op.id, op.parent)) break;
          this.detach(op.id);
          this.updateChildren(op.parent, (list) => {
            list.splice(Math.max(0, Math.min(Number(op.index) || 0, list.length)), 0, op.id);
          });
          this.parentOf.set(op.id, op.parent);
          break;
        }
        case "destroy":
          this.detach(op.id);
          this.forget(op.id);
          break;
      }
    }
  }

  private canPlace(id: number, parent: number): boolean {
    if (parent === 0) return true;
    if (!this.nodes.has(parent)) return false;
    for (
      let at: number | undefined = parent;
      at !== undefined && at !== 0;
      at = this.parentOf.get(at)
    )
      if (at === id) return false;
    return true;
  }

  private replace(id: number, update: (node: MirrorNode) => MirrorNode) {
    const node = this.nodes.get(id);
    if (!node) return;
    this.nodes.set(id, update(node));
    this.touchAncestors(id);
    this.copied.add(id);
  }

  private touchAncestors(id: number) {
    let parent = this.parentOf.get(id);
    while (parent !== undefined && parent !== 0 && !this.copied.has(parent)) {
      const node = this.nodes.get(parent);
      if (node) this.nodes.set(parent, { ...node });
      this.copied.add(parent);
      parent = this.parentOf.get(parent);
    }
    if (parent === 0) this.ownRoot();
  }

  private ownRoot() {
    if (this.ownLists.has(0)) return;
    this.root = [...this.root];
    this.ownLists.add(0);
  }

  private updateChildren(parent: number, change: (list: number[]) => void) {
    if (parent === 0) {
      this.ownRoot();
      change(this.root);
      return;
    }
    const node = this.nodes.get(parent);
    if (!node) return;
    if (!this.ownLists.has(parent)) {
      this.nodes.set(parent, { ...node, children: [...node.children] });
      this.ownLists.add(parent);
    }
    change(this.nodes.get(parent)!.children);
    this.touchAncestors(parent);
    this.copied.add(parent);
  }

  private detach(id: number) {
    const parent = this.parentOf.get(id);
    if (parent === undefined) return;
    this.updateChildren(parent, (list) => {
      const i = list.indexOf(id);
      if (i >= 0) list.splice(i, 1);
    });
    this.parentOf.delete(id);
  }

  private forget(id: number) {
    const node = this.nodes.get(id);
    for (const child of node?.children ?? []) {
      this.parentOf.delete(child);
      this.forget(child);
    }
    this.nodes.delete(id);
  }
}
