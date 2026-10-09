import {
  TEXT_NODE,
  validateProps,
  type EncodedElement,
  type PropIssue,
} from "@open-intelligent-ui/core";
import { MARKDOWN_TAGS } from "@open-intelligent-ui/core/compiler";
import {
  Component,
  Fragment,
  isValidElement,
  memo,
  type ComponentType,
  type ReactNode,
} from "react";
import type { ComponentRenderProps, Library } from "./define";
import type { OpenUIError } from "./errors";
import type { MirrorNode } from "./mirror";
import { StreamText } from "./motion";

// Longer than the `oui-enter` animation (420ms), so a re-render never cuts it short.
const ENTER_MS = 700;
const HEADING_WAIT_MS = 1000;

type Resolved =
  | { known: false }
  | {
      known: true;
      View: ComponentType<ComponentRenderProps>;
      props: Record<string, unknown>;
      issues: PropIssue[];
      omit: boolean;
      /** The schema declares `children`, so nested markup is also passed as `props.children`. */
      childrenProp: boolean;
    };

export interface TreeContext {
  nodes: ReadonlyMap<number, MirrorNode>;
  library: Library;
  streaming: boolean;
  resolve(type: string, props: Record<string, unknown>): Resolved;
  renderFailed(key: object, error: OpenUIError | null): void;
}

export interface TreeOptions {
  nodes: ReadonlyMap<number, MirrorNode>;
  library: Library;
  streaming: boolean;
  trigger(slot: string, args: unknown[]): void;
  renderFailed(key: object, error: OpenUIError | null): void;
}

// Callbacks are cached per slot so components see stable functions; validation is cached per
// encoded props object, which the mirror replaces whenever a prop changes.
export function createTreeContext(options: TreeOptions): TreeContext {
  const callbacks = new Map<string, (...args: unknown[]) => void>();
  let pruneAt = 256;
  const resolved = new WeakMap<object, Resolved>();

  const callback = (slot: string) => {
    let fn = callbacks.get(slot);
    if (!fn) {
      fn = (...args: unknown[]) => options.trigger(slot, toCloneable(args));
      callbacks.set(slot, fn);
      // Slots start with their node's id; drop those of destroyed nodes now and then.
      if (callbacks.size > pruneAt) {
        for (const key of callbacks.keys())
          if (!options.nodes.has(parseInt(key))) callbacks.delete(key);
        pruneAt = 2 * callbacks.size + 256;
      }
    }
    return fn;
  };

  const decode = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(decode);
    if (!value || typeof value !== "object") return value;
    const record = value as Record<string, unknown>;
    if (typeof record["$fn"] === "string") return callback(record["$fn"]);
    if ("$el" in record) {
      const el = record["$el"];
      return isEncodedElement(el) ? <EncodedTreeElement el={el} ctx={ctx} /> : null;
    }
    return decodeObject(record);
  };

  // The engine escapes `$` keys of program data so they cannot pose as `$fn` or `$el`.
  const decodeObject = (record: Record<string, unknown>) => {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(record))
      out[key.startsWith("$$") ? key.slice(1) : key] = decode(v);
    return out;
  };
  const decodeProps = (record: Record<string, unknown>) => {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(record)) out[key] = decode(v);
    return out;
  };

  const ctx: TreeContext = {
    nodes: options.nodes,
    library: options.library,
    streaming: options.streaming,
    renderFailed: options.renderFailed,
    resolve(type, props) {
      const cached = resolved.get(props);
      if (cached) return cached;
      const { components } = options.library;
      const definition = Object.hasOwn(components, type) ? components[type] : undefined;
      const result: Resolved = definition
        ? {
            known: true,
            View: definition.component as ComponentType<ComponentRenderProps>,
            childrenProp: "children" in definition.props._zod.def.shape,
            ...validateProps(definition.props, decodeProps(props), { isNode: isValidElement }),
          }
        : { known: false };
      resolved.set(props, result);
      return result;
    },
  };
  return ctx;
}

function isEncodedElement(value: unknown): value is EncodedElement {
  if (!value || typeof value !== "object") return false;
  const el = value as Partial<EncodedElement>;
  return (
    typeof el.type === "string" &&
    !!el.props &&
    typeof el.props === "object" &&
    !Array.isArray(el.props) &&
    Array.isArray(el.children)
  );
}

// Handler arguments cross a message channel: keep JSON values, drop DOM events.
function toCloneable(args: unknown[]): unknown[] {
  return args.map((arg) => {
    if (arg && typeof arg === "object" && "nativeEvent" in arg) return undefined;
    try {
      return JSON.parse(JSON.stringify(arg ?? null));
    } catch {
      return undefined;
    }
  });
}

/** Renders any prop value: strings, numbers, elements and arrays of them. */
export function renderNode(value: unknown): ReactNode {
  if (value === null || value === undefined || typeof value === "boolean") return null;
  if (typeof value === "string" || typeof value === "number") return value;
  if (isValidElement(value)) return value;
  if (Array.isArray(value))
    return value.map((v, i) => <Fragment key={i}>{renderNode(v)}</Fragment>);
  return null;
}

const MirrorNodeView = memo(function MirrorNodeView({
  node,
  ctx,
}: {
  node: MirrorNode;
  ctx: TreeContext;
}) {
  if (node.type === TEXT_NODE)
    return <StreamText text={node.text ?? ""} streaming={ctx.streaming} />;
  const fresh = ctx.streaming && Date.now() - node.born < ENTER_MS;
  return (
    <TreeElement
      type={node.type}
      props={node.props}
      ctx={ctx}
      boundaryKey={node}
      className={fresh ? "oui-enter" : undefined}
    >
      {node.children.length ? <MirrorChildren ids={node.children} ctx={ctx} /> : undefined}
    </TreeElement>
  );
});

// While streaming, a heading waits until something visible follows it, so a section never
// shows as a heading above empty space, but not for long: a tool's title above a block of logic
// shows after HEADING_WAIT_MS. Every streamed chunk re-renders, so no timer is needed.
export function visibleRoot(ids: number[], ctx: TreeContext): number[] {
  if (!ctx.streaming) return ids;
  const out = [...ids];
  const now = Date.now();
  for (let i = out.length - 1; i >= 0; i--) {
    const node = ctx.nodes.get(out[i]);
    if (node?.type === MARKDOWN_TAGS.heading && now - node.born < HEADING_WAIT_MS) out.splice(i, 1);
    else if (node && !rendersNothing(node, ctx)) break;
  }
  return out;
}

function rendersNothing(node: MirrorNode, ctx: TreeContext): boolean {
  if (node.type === TEXT_NODE) return !node.text?.trim();
  const resolved = ctx.resolve(node.type, node.props);
  return resolved.known ? resolved.omit : !/^[a-z]/.test(node.type);
}

export function MirrorChildren({ ids, ctx }: { ids: number[]; ctx: TreeContext }) {
  return ids.map((id) => {
    const child = ctx.nodes.get(id);
    return child ? <MirrorNodeView key={id} node={child} ctx={ctx} /> : null;
  });
}

function EncodedTreeElement({ el, ctx }: { el: EncodedElement; ctx: TreeContext }) {
  return (
    <TreeElement type={el.type} props={el.props} ctx={ctx} boundaryKey={el}>
      {el.children.map((child, i) => (
        <Fragment key={i}>
          {typeof child === "string" ? (
            child
          ) : isEncodedElement((child as { $el?: unknown } | null)?.$el) ? (
            <EncodedTreeElement el={(child as { $el: EncodedElement }).$el} ctx={ctx} />
          ) : null}
        </Fragment>
      ))}
    </TreeElement>
  );
}

interface ElementProps {
  type: string;
  props: Record<string, unknown>;
  ctx: TreeContext;
  boundaryKey: object;
  className?: string;
  children?: ReactNode;
}

function TreeElement({ type, props, ctx, boundaryKey, className, children }: ElementProps) {
  const resolved = ctx.resolve(type, props);
  // An unknown lowercase tag still shows its content; an unknown component does not.
  if (!resolved.known) return /^[a-z]/.test(type) ? <>{children}</> : null;
  if (resolved.omit) return null;
  const { View } = resolved;
  return (
    <ElementBoundary type={type} errorKey={boundaryKey} report={ctx.renderFailed}>
      <View
        props={resolved.childrenProp ? { ...resolved.props, children } : resolved.props}
        renderNode={renderNode}
        className={className}
      >
        {children}
      </View>
    </ElementBoundary>
  );
}

interface BoundaryProps {
  type: string;
  errorKey: object;
  report(key: object, error: OpenUIError | null): void;
  children: ReactNode;
}

// Keeps the last good render of an element that throws, so a transient error while streaming
// does not blank the view.
class ElementBoundary extends Component<BoundaryProps, { failed: boolean }> {
  override state = { failed: false };
  private lastGood: ReactNode = null;
  // The element's key object is replaced on every update; errors stay filed under the first.
  private readonly errorKey = this.props.errorKey;

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override componentDidCatch(error: Error) {
    this.props.report(this.errorKey, {
      source: "runtime",
      code: "render-error",
      component: this.props.type,
      message: `<${this.props.type}> failed to render: ${error.message}`,
    });
  }

  override componentDidMount() {
    if (!this.state.failed) this.lastGood = this.props.children;
  }

  override componentDidUpdate(previous: BoundaryProps, previousState: { failed: boolean }) {
    if (!this.state.failed) {
      this.lastGood = this.props.children;
      if (previousState.failed) this.props.report(this.errorKey, null);
    } else if (previous.children !== this.props.children) this.setState({ failed: false });
  }

  override componentWillUnmount() {
    this.props.report(this.errorKey, null);
  }

  override render() {
    return this.state.failed ? this.lastGood : this.props.children;
  }
}

export function collectTreeErrors(root: number[], ctx: TreeContext): OpenUIError[] {
  const errors: OpenUIError[] = [];
  const visitElement = (type: string, props: Record<string, unknown>) => {
    const resolved = ctx.resolve(type, props);
    if (!resolved.known) {
      errors.push({
        source: "parser",
        code: "unknown-component",
        component: type,
        message: `Unknown component <${type}>`,
      });
    } else {
      for (const issue of resolved.issues)
        errors.push({
          source: "parser",
          code: issue.code,
          component: type,
          path: `/${issue.prop}`,
          message: issue.message,
          ...(resolved.omit ? { hint: "The element was not rendered." } : {}),
        });
    }
    visitValue(props);
  };
  const visitValue = (value: unknown) => {
    if (Array.isArray(value)) value.forEach(visitValue);
    else if (value && typeof value === "object") {
      const el = (value as { $el?: unknown }).$el;
      if (isEncodedElement(el)) {
        visitElement(el.type, el.props);
        el.children.forEach(visitValue);
      } else Object.values(value).forEach(visitValue);
    }
  };
  const visitNode = (id: number) => {
    const node = ctx.nodes.get(id);
    if (!node || node.type === TEXT_NODE) return;
    visitElement(node.type, node.props);
    node.children.forEach(visitNode);
  };
  root.forEach(visitNode);
  return errors;
}
