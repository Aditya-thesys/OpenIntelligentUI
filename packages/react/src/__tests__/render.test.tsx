// @vitest-environment jsdom
import { createEngine, type SandboxOptions } from "@open-intelligent-ui/core";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { z } from "zod/v4";
import { builtinComponents, builtinGroups, builtinLibrary } from "../components";
import { svgAttributes } from "../components/safety";
import type { OpenUIError } from "../errors";
import {
  callback,
  createLibrary,
  defineComponent,
  Renderer,
  useStateField,
  type Library,
} from "../index";
import { Mirror } from "../mirror";
import { SettledContext, useOptimisticValue } from "../useOptimisticValue";

// The real sandbox needs an iframe and a worker; tests run the same engine in-process.
let sandboxOptions: SandboxOptions | undefined;
vi.mock("@open-intelligent-ui/core", async (original) => ({
  ...(await original<typeof import("@open-intelligent-ui/core")>()),
  createSandbox(options: SandboxOptions) {
    sandboxOptions = options;
    const engine = createEngine({
      emit: (batch) => options.onBatch(batch),
      persistState: (state) => options.onPersist?.(state),
      callHost: (name, args) => options.onHostCall?.(name, args),
    });
    return {
      load: (
        code: string,
        constants?: Record<string, unknown>,
        appData?: unknown,
        state?: Record<string, unknown>,
      ) => engine.load({ code, constants, appData, state }),
      update: (code: string, constants?: Record<string, unknown>) =>
        engine.update({ code, constants }),
      setData: (appData: unknown) => engine.setData(appData),
      setState: (state: Record<string, unknown>) => engine.setState(state),
      trigger: (slot: string, args: unknown[] = []) => engine.trigger(slot, args),
      dispose: () => {},
    };
  },
}));

beforeAll(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  globalThis.ResizeObserver ??= class {
    observe() {}
    disconnect() {}
    unobserve() {}
  };
});

let cleanup: (() => void) | undefined;
afterEach(() => cleanup?.());

async function mount(library: Library = builtinLibrary, initialState?: Record<string, unknown>) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const errors: OpenUIError[][] = [];
  const states: Record<string, unknown>[] = [];
  cleanup = () => {
    act(() => root.unmount());
    container.remove();
  };
  const show = async (response: string, isStreaming = false) => {
    await act(async () => {
      root.render(
        <Renderer
          library={library}
          response={response}
          isStreaming={isStreaming}
          onError={(e) => errors.push(e)}
          onStateUpdate={(state) => states.push(state)}
          initialState={initialState}
        />,
      );
    });
  };
  return {
    container,
    errors,
    show,
    lastErrors: () => errors[errors.length - 1] ?? [],
    lastState: () => states[states.length - 1],
  };
}

describe("Renderer", () => {
  it("renders a stream as it grows and ends in the full tree", async () => {
    const { container, show, lastErrors } = await mount();
    const full =
      '## Plan\n\n<row gap={2}><badge color="success">Ready</badge><badge>Two</badge></row>';
    await show(full.slice(0, full.indexOf("<badge>Two")), true);
    expect(container.textContent).toContain("Ready");
    expect(container.textContent).not.toContain("Two");
    await show(full);
    expect(container.querySelector(".oui-title-lg")?.textContent).toBe("Plan");
    expect(container.querySelectorAll(".oui-badge")).toHaveLength(2);
    expect(lastErrors()).toEqual([]);
  });

  it("reports a name the finished answer never declared", async () => {
    const { container, show, lastErrors } = await mount();
    await show("Before\n<text>Hi {foo}</text>\nAfter", true);
    await show("Before\n<text>Hi {foo}</text>\nAfter");
    expect(container.textContent).toBe("BeforeHi After");
    expect(lastErrors().map((e) => e.code)).toEqual(["undefined-name"]);
  });

  it("shows a streaming heading once something visible follows it", async () => {
    const { container, show } = await mount();
    await show("Intro.\n\n## Route\n<image src={photo}/>", true);
    expect(container.textContent).toBe("Intro.");
    await show(
      'Intro.\n\n## Route\n<image src={photo}/>\n{@body const photo = "https://a.b/c.png"}',
      true,
    );
    await act(() => new Promise((resolve) => setTimeout(resolve, 100)));
    expect(container.textContent).toBe("Intro.Route");
    expect(container.querySelector(".oui-root")?.getAttribute("data-theme")).toBe("light");
  });

  it("drops invalid props, omits elements missing required props, and reports both", async () => {
    const { container, show, lastErrors } = await mount();
    await show('<badge color="purple">A</badge><image alt="x"/><Widget/>');
    expect(container.querySelector(".oui-badge")?.className).toContain("oui-badge-secondary");
    expect(container.querySelector("img")).toBeNull();
    expect(lastErrors().map((e) => [e.code, e.component])).toEqual([
      ["type-mismatch", "badge"],
      ["missing-required", "image"],
      ["unknown-component", "Widget"],
    ]);
  });

  it("only allows safe URLs and CSS", async () => {
    const { container, show } = await mount();
    await show(
      '<link href="javascript:alert(1)">a</link><link href="https://example.com">b</link>' +
        '<image src="https://example.com/a.png"/><image src="data:text/html,x"/>' +
        '<box background="url(https://example.com/t.png)">c</box>' +
        '<svg><rect fill="url(#g)" style={{background: "url(https://x)"}}/></svg>',
    );
    const links = [...container.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    expect(links).toEqual(["https://example.com"]);
    expect([...container.querySelectorAll("img")].map((i) => i.getAttribute("src"))).toEqual([
      "https://example.com/a.png",
    ]);
    expect(container.innerHTML).not.toContain("url(https");
    expect(container.querySelector("rect")?.getAttribute("fill")).toBe("url(#g)");
    const f = () => {};
    expect(svgAttributes({ onClick: f, onAnimationStart: f, onPointerMove: f })).toEqual({
      onClick: f,
    });
  });

  it("passes stable callbacks that run the program's handler", async () => {
    const seen: unknown[] = [];
    const Probe = defineComponent({
      name: "probe",
      props: z.object({ onClick: callback(), label: z.string() }),
      description: "Button that records its handler",
      component: ({ props }) => {
        seen.push(props.onClick);
        return <button onClick={() => props.onClick()}>{props.label}</button>;
      },
    });
    const library = createLibrary({ components: [Probe] });
    const { container, show } = await mount(library);
    await show(
      '{@body const [n, setN] = useState(1)}\n<probe label={"n=" + n} onClick={() => setN(n + 1)}/>',
    );
    await act(async () => container.querySelector("button")?.click());
    expect(container.textContent).toBe("n=2");
    expect(new Set(seen).size).toBe(1);
  });

  it("restores program state and component fields from saved state", async () => {
    const Toggle = defineComponent({
      name: "toggle",
      props: z.object({}),
      description: "Button that keeps a field",
      component: function ToggleView() {
        const field = useStateField("on", false);
        return <button onClick={() => field.setValue(!field.value)}>{String(field.value)}</button>;
      },
    });
    const library = createLibrary({ components: [...builtinComponents, Toggle] });
    const program =
      "{@body const [n, setN] = useState(1)}\n<button onClick={() => setN(n + 1)}>{n}</button><toggle/>";
    const first = await mount(library);
    await first.show(program);
    const [count, toggle] = [...first.container.querySelectorAll("button")];
    await act(async () => count?.click());
    await act(async () => toggle?.click());
    const saved = first.lastState();
    expect(saved).toEqual({ n: 2, "@fields": { on: true } });
    cleanup?.();

    const second = await mount(library, saved);
    await second.show(program);
    expect(second.container.textContent).toBe("2true");
  });

  it("lets a number field be cleared while the program stores 0", async () => {
    const { container, show } = await mount();
    await show(
      '{@body const [n, setN] = useState(5)}\n<input inputType="number" value={n} onChange={(v) => setN(Number(v))}/><text>{n * 2}</text>',
    );
    const input = container.querySelector("input")!;
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    await act(async () => {
      setValue.call(input, "");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(input.value).toBe("");
    expect(container.textContent).toBe("0");
  });

  it("adds the Markdown components a library leaves out", async () => {
    const library = createLibrary({ components: [] });
    const { container, show } = await mount(library);
    await show("Hello **world**\n\n| a | b |\n|---|---|\n| 1 | 2 |");
    expect(container.querySelector("strong")?.textContent).toBe("world");
    expect(container.querySelectorAll("td")).toHaveLength(2);
  });

  it("does not let program data pose as an element", async () => {
    const { container, show, lastErrors } = await mount();
    await show('<box data={{$el: {type: "x"}, $fn: "1.onClick"}}><text>ok</text></box>');
    expect(container.textContent).toBe("ok");
    expect(lastErrors()).toEqual([]);
  });

  it("shows the text version and reports when the sandbox gives up", async () => {
    const { container, show, lastErrors } = await mount();
    await show("Plain words.\n\n<text>{useNow()}</text>");
    await act(async () => sandboxOptions?.onRestart?.("no answer within 2000 ms", true));
    expect(container.querySelector(".oui-fallback-text")?.textContent).toBe("Plain words.");
    expect(lastErrors()).toContainEqual(expect.objectContaining({ code: "sandbox-quarantined" }));
  });
});

describe("builtin library prompt", () => {
  const prompt = builtinLibrary.prompt();

  it("teaches the syntax and every grouped component", () => {
    expect(prompt).toContain("useState(initial)");
    expect(prompt).toContain("{#each items as item, i}");
    for (const group of builtinGroups)
      for (const name of group.components) expect(prompt).toContain(`\`<${name}`);
    expect(prompt).not.toContain("### Other");
  });

  it("describes callbacks and choices", () => {
    expect(prompt).toContain("onChange?={(value: number) => …}");
    expect(prompt).toContain('variant?="solid|soft|outline|ghost"');
  });
});

describe("Mirror", () => {
  it("skips operations that would make a cycle", () => {
    const mirror = new Mirror();
    mirror.apply([
      { op: "create", id: 1, type: "box" },
      { op: "create", id: 2, type: "box" },
      { op: "place", id: 2, parent: 1, index: 0 },
      { op: "place", id: 1, parent: 1, index: 0 },
      { op: "place", id: 1, parent: 2, index: 0 },
      { op: "set", id: 2, name: "gap", value: 1 },
    ]);
    expect(mirror.nodes.get(1)?.children).toEqual([2]);
    expect(mirror.nodes.get(2)?.children).toEqual([]);
  });

  it("ignores a second create and a place under a missing parent", () => {
    const mirror = new Mirror();
    mirror.apply([
      { op: "create", id: 1, type: "box" },
      { op: "create", id: 1, type: "button" },
      { op: "place", id: 1, parent: 7, index: 0 },
    ]);
    expect(mirror.nodes.get(1)?.type).toBe("box");
    expect(mirror.root).toEqual([]);
  });
});

describe("useOptimisticValue", () => {
  it("keeps typed text while older echoes arrive, then follows the program", async () => {
    let update: (next: string) => void = () => {};
    const seen: (string | undefined)[] = [];
    function Field({ value }: { value: string }) {
      const [local, setLocal] = useOptimisticValue(value, () => {});
      update = setLocal;
      seen.push(local);
      return null;
    }
    const root = createRoot(document.createElement("div"));
    const render = (value: string, settled = 0) =>
      act(async () =>
        root.render(
          <SettledContext.Provider value={settled}>
            <Field value={value} />
          </SettledContext.Provider>,
        ),
      );
    await render("");
    await act(async () => {
      update("a");
      update("ab");
    });
    await render("a");
    expect(seen.at(-1)).toBe("ab");
    await render("ab");
    await render("reset");
    expect(seen.at(-1)).toBe("reset");
    // The program ignored a change: once the sandbox is idle, its value comes back.
    await act(async () => update("resets"));
    await render("reset", 1);
    expect(seen.at(-1)).toBe("reset");
    act(() => root.unmount());
  });

  it("keeps what the user did when the program gives no value", async () => {
    let update: (next: string) => void = () => {};
    let local: string | undefined;
    function Field() {
      [local, update] = useOptimisticValue<string>(undefined, () => {});
      return null;
    }
    const root = createRoot(document.createElement("div"));
    const render = (settled: number) =>
      act(async () =>
        root.render(
          <SettledContext.Provider value={settled}>
            <Field />
          </SettledContext.Provider>,
        ),
      );
    await render(0);
    await act(async () => update("Ada"));
    await render(1);
    expect(local).toBe("Ada");
    act(() => root.unmount());
  });
});
