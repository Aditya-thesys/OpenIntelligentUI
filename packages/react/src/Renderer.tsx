import { createSandbox, type ProgramError, type Sandbox } from "@open-intelligent-ui/core";
import {
  compile,
  type CompileOptions,
  type CompileResult,
  type Diagnostic,
} from "@open-intelligent-ui/core/compiler";
import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { Library } from "./define";
import type { OpenUIError, OpenUIErrorCode } from "./errors";
import { Mirror } from "./mirror";
import { GrowingHeight } from "./motion";
import { FIELDS_KEY, ResponseStateContext, ResponseStateStore } from "./stateField";
import { collectTreeErrors, createTreeContext, MirrorChildren, visibleRoot } from "./tree";
import { SettledContext } from "./useOptimisticValue";
import { useStreamingThrottle } from "./useStreamingThrottle";

export interface HostAction {
  /** Name the program passed to `action(name, ...args)`. */
  name: string;
  args: unknown[];
}

export interface RendererProps {
  /** Response text from the model; may be a growing stream prefix. */
  response: string | null;
  /** Component library from createLibrary(). */
  library: Library;
  /** True while the response is still streaming. */
  isStreaming?: boolean;
  /** Problems the model could fix, reported once streaming ends and with [] once resolved. */
  onError?: (errors: OpenUIError[]) => void;
  /** The program called `action(name, ...args)`; the arguments are model-written, validate them. */
  onAction?: (action: HostAction) => void;
  /** Program state variables, plus `useStateField` fields under `"@fields"`, after each change. */
  onStateUpdate?: (state: Record<string, unknown>) => void;
  /** State from `onStateUpdate` to restore; a later different value replaces the current state. */
  initialState?: Record<string, unknown>;
  /** Read-only data the program can read with `useAppData`. */
  appData?: unknown;
  /** Called with each compile result. */
  onParseResult?: (result: CompileResult) => void;
  /** Shown above the plain-text version when the program cannot be displayed. */
  fallbackMessage?: string;
  /** Color scheme of the host page; the OS setting is not consulted. */
  theme?: "light" | "dark";
  className?: string;
}

const RUNTIME_CODES: Record<ProgramError["kind"], OpenUIErrorCode> = {
  program: "runtime-error",
  handler: "handler-error",
  effect: "effect-error",
  "render-loop": "render-loop",
};

const CLEARED_BY_A_COMMIT: OpenUIErrorCode[] = [
  ...Object.values(RUNTIME_CODES),
  "sandbox-restarted",
];

const STREAM_UPDATE_MS = 60;

const DEFAULT_FALLBACK_MESSAGE =
  "Part of this answer could not be displayed as an interface. Here is the text version.";

/** Renders one model response, run in its own sandbox; key it by the response's id. */
export function Renderer({
  response,
  library,
  isStreaming = false,
  onError,
  onAction,
  onStateUpdate,
  initialState,
  appData,
  onParseResult,
  fallbackMessage = DEFAULT_FALLBACK_MESSAGE,
  theme = "light",
  className,
}: RendererProps) {
  const callbacks = useRef({ onError, onAction, onStateUpdate, onParseResult });
  callbacks.current = { onError, onAction, onStateUpdate, onParseResult };
  const [saved] = useState(() => splitState(initialState));
  const programState = useRef(saved.program);
  // The last state reported or restored, so an initialState that echoes it is not re-applied.
  const knownState = useRef(JSON.stringify(initialState ?? {}));
  const report = (state: Record<string, unknown>) => {
    knownState.current = JSON.stringify(state);
    callbacks.current.onStateUpdate?.(state);
  };
  const [componentState] = useState(
    () =>
      new ResponseStateStore(saved.fields, (fields) =>
        report({ ...programState.current, [FIELDS_KEY]: fields }),
      ),
  );
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const [settled, bumpSettled] = useReducer((n: number) => n + 1, 0);
  const mirror = useRef(new Mirror());
  const sandbox = useRef<Sandbox | null>(null);
  const loaded = useRef(false);
  const sentAppData = useRef<unknown>(undefined);
  const [runtimeErrors, setRuntimeErrors] = useState<Partial<Record<OpenUIErrorCode, string>>>({});
  const renderErrors = useRef(new Map<object, OpenUIError>());
  const [renderErrorsVersion, renderErrorsChanged] = useReducer((n: number) => n + 1, 0);

  useEffect(() => {
    const setError = (code: OpenUIErrorCode, message: string | undefined) =>
      setRuntimeErrors((previous) =>
        previous[code] === message ? previous : { ...previous, [code]: message },
      );
    const sb = createSandbox({
      onBatch: (batch) => {
        // Every commit sends a batch, so one without an error means the program runs again.
        if (batch.error) setError(RUNTIME_CODES[batch.error.kind], batch.error.message);
        else {
          for (const code of CLEARED_BY_A_COMMIT) setError(code, undefined);
          setError("undefined-name", batch.undefinedNames?.join("; "));
        }
        if (batch.ops.length) {
          mirror.current.apply(batch.ops);
          rerender();
        }
      },
      onPersist: (state) => {
        programState.current = state;
        report({ ...state, [FIELDS_KEY]: componentState.values() });
      },
      onHostCall: (name, args) => callbacks.current.onAction?.({ name, args }),
      onIdle: bumpSettled,
      onRestart: (reason, quarantined) => {
        mirror.current = new Mirror();
        rerender();
        setError(quarantined ? "sandbox-quarantined" : "sandbox-restarted", reason);
      },
    });
    sandbox.current = sb;
    loaded.current = false;
    mirror.current = new Mirror();
    rerender();
    return () => {
      sb.dispose();
      sandbox.current = null;
    };
  }, [componentState]);

  const source = useStreamingThrottle(response ?? "", isStreaming, STREAM_UPDATE_MS);
  const components = useMemo(() => new Set(Object.keys(library.components)), [library]);
  const compiled = useMemo(
    () => safeCompile(source, { progressive: isStreaming, orderStatements: true, components }),
    [source, isStreaming, components],
  );

  useEffect(() => {
    callbacks.current.onParseResult?.(compiled);
    const sb = sandbox.current;
    if (!sb) return;
    if (loaded.current) sb.update(compiled.code, compiled.constants);
    else {
      sb.load(compiled.code, compiled.constants, appData ?? {}, programState.current);
      sentAppData.current = appData;
      loaded.current = true;
    }
    // State lives in the sandbox after the first load; later changes go through the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compiled]);

  useEffect(() => {
    if (!loaded.current || appData === undefined || appData === sentAppData.current) return;
    sentAppData.current = appData;
    sandbox.current?.setData(appData);
  }, [appData]);

  const initialKey = JSON.stringify(initialState ?? {});
  useEffect(() => {
    if (initialKey === knownState.current) return;
    knownState.current = initialKey;
    const next = splitState(initialState);
    programState.current = next.program;
    componentState.replace(next.fields);
    sandbox.current?.setState(next.program);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialKey]);

  const nodes = mirror.current.nodes;
  const ctx = useMemo(
    () =>
      createTreeContext({
        nodes,
        library,
        streaming: isStreaming,
        trigger: (slot, args) => sandbox.current?.trigger(slot, args),
        renderFailed: (key, error) => {
          const current = renderErrors.current.get(key);
          if (error ? current?.message === error.message : !current) return;
          if (error) renderErrors.current.set(key, error);
          else renderErrors.current.delete(key);
          renderErrorsChanged();
        },
      }),
    [nodes, library, isStreaming],
  );

  const root = mirror.current.root;
  const reported = useRef("[]");
  useEffect(() => {
    if (isStreaming) return;
    const errors: OpenUIError[] = [
      ...compiled.diagnostics.map(diagnosticError),
      ...Object.entries(runtimeErrors)
        .filter((entry): entry is [OpenUIErrorCode, string] => entry[1] !== undefined)
        .map(([code, message]): OpenUIError => ({ source: "runtime", code, message })),
      ...collectTreeErrors(root, ctx),
      ...renderErrors.current.values(),
    ];
    const key = JSON.stringify(errors);
    if (key === reported.current) return;
    reported.current = key;
    callbacks.current.onError?.(errors);
  }, [isStreaming, compiled, runtimeErrors, root, ctx, renderErrorsVersion]);

  const failed =
    !isStreaming && !!(runtimeErrors["runtime-error"] ?? runtimeErrors["sandbox-quarantined"]);

  return (
    <div
      className={["oui-root", className].filter(Boolean).join(" ")}
      data-theme={theme}
      data-streaming={isStreaming || undefined}
    >
      <GrowingHeight active={isStreaming}>
        <div className="oui-flow">
          <ResponseStateContext.Provider value={componentState}>
            <SettledContext.Provider value={settled}>
              <MirrorChildren ids={visibleRoot(root, ctx)} ctx={ctx} />
            </SettledContext.Provider>
          </ResponseStateContext.Provider>
        </div>
        {failed && (
          <div className="oui-fallback" role="note">
            <p className="oui-fallback-note">{fallbackMessage}</p>
            <div className="oui-fallback-text">{compiled.fallbackText}</div>
          </div>
        )}
      </GrowingHeight>
    </div>
  );
}

// A compiler crash must not unmount the host app; the program error shows the text version.
function safeCompile(source: string, options: CompileOptions): CompileResult {
  try {
    return compile(source, options);
  } catch (error) {
    const message = JSON.stringify(`The answer could not be compiled: ${String(error)}`);
    return {
      code: `throw new Error(${message})`,
      constants: {},
      diagnostics: [],
      fallbackText: source,
    };
  }
}

function splitState(state: Record<string, unknown> | undefined) {
  const { [FIELDS_KEY]: fields, ...program } = state ?? {};
  const isRecord = (v: unknown): v is Record<string, unknown> =>
    !!v && typeof v === "object" && !Array.isArray(v);
  return { program, fields: isRecord(fields) ? fields : {} };
}

function diagnosticError(d: Diagnostic): OpenUIError {
  const what = d.code.replaceAll("-", " ");
  return {
    source: "parser",
    code: d.code,
    message: `${what}${d.name ? ` (${d.name})` : ""} at line ${d.line}, column ${d.column}`,
  };
}
