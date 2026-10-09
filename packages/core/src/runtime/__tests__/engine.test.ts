import { describe, expect, it } from "vitest";
import type { Op } from "../engine";
import { applyBatches, testEngine } from "./helpers";

function run(src: string) {
  const t = testEngine();
  t.load(src);
  return t;
}

describe("engine", () => {
  it("renders, triggers a setter and sends only the change", () => {
    const r = run(
      '{@body const [seats,setSeats] = useState(8)}\n{@body const price = seats*29}\n<box gap={2}>\n<slider min={1} max={50} value={seats} onChange={setSeats}/>\n<title size="xl">${price}/mo</title>\n</box>',
    );
    expect(applyBatches(r.batches).text).toBe('box(slider(),title("$232/mo"))');
    const slider = r.last().ops.find((o) => o.op === "set" && o.name === "onChange") as Extract<
      Op,
      { op: "set" }
    >;
    expect(slider.value).toEqual({ $fn: `${slider.id}.onChange` });
    r.engine.trigger(`${slider.id}.onChange`, [9]);
    expect(r.last().ops).toEqual([
      { op: "set", id: slider.id, name: "value", value: 9 },
      expect.objectContaining({ op: "text", text: "$261/mo" }),
    ]);
    expect(r.persisted).toEqual([{ seats: 9 }]);
  });

  it("keeps handler slots stable for inline arrows (no re-sends)", () => {
    const r = run(
      "{@body const [n,setN] = useState(0)}\n<button onClick={()=>setN(n+1)}>Add</button>\n<text>{n}</text>",
    );
    const btn = r.last().ops.find((o) => o.op === "create" && o.type === "button")!;
    r.engine.trigger(`${btn.id}.onClick`);
    r.engine.trigger(`${btn.id}.onClick`);
    expect(applyBatches(r.batches).text).toBe('button("Add"),text("2")');
    expect(r.last().ops).toEqual([expect.objectContaining({ op: "text", text: "2" })]);
  });

  it("removes a keyed row from an each block", () => {
    const r = run(
      '{@body const [tasks,setTasks] = useState([{id:1,name:"A"},{id:2,name:"B"},{id:3,name:"C"}])}\n<box>\n{#each tasks as t}\n<row key={t.id}><text>{t.name}</text><button onClick={()=>setTasks(old=>old.filter(x=>x.id!==t.id))}>x</button></row>\n{/each}\n</box>',
    );
    const buttons = r.last().ops.filter((o) => o.op === "create" && o.type === "button");
    r.engine.trigger(`${buttons[1].id}.onClick`);
    expect(applyBatches(r.batches).text).toBe(
      'box(row(text("A"),button("x")),row(text("C"),button("x")))',
    );
    expect(r.last().ops.filter((o) => o.op === "destroy")).toHaveLength(1);
  });

  it("ends a // comment at the brace of a one-line value, and at the line end otherwise", () => {
    const r = run(
      "{@body const [n, setN] = useState(2) // count}\n{@body\nfunction twice(x) {\n  return x * 2 // double }\n}\n}\n<text>{n // note}</text>\nTotal {twice(n) // x} today.\n<slider value={n // x} max={9}/>",
    );
    const tree = applyBatches(r.batches);
    expect(tree.text).toBe('text("2"),text("Total 4 today."),slider()');
    expect([...tree.nodes.values()].find((n) => n.type === "slider")?.props.value).toBe(2);
  });

  it("switches if/else branches", () => {
    const r = run(
      '{@body const [on,setOn] = useState(true)}\n<checkbox checked={on} onChange={setOn}/>\n{#if on}<text color="success">Yearly</text>{:else}<badge>Monthly</badge>{/if}',
    );
    const cb = r.last().ops.find((o) => o.op === "create" && o.type === "checkbox")!;
    r.engine.trigger(`${cb.id}.onChange`, [false]);
    expect(applyBatches(r.batches).text).toBe('checkbox(),badge("Monthly")');
  });

  it("keeps state across streaming updates and falls back on a broken program", () => {
    const t = testEngine();
    const full =
      "{@body const [n,setN] = useState(1)}\n<button onClick={()=>setN(n+1)}>+</button>\n<text>Count {n}</text>\n<text>Done</text>";
    t.load(full.slice(0, full.indexOf("<text>Count")));
    const btn = t.batches[0]!.ops.find((o) => o.op === "create" && o.type === "button")!;
    t.engine.trigger(`${btn.id}.onClick`);
    t.update(full);
    expect(applyBatches(t.batches).text).toBe('button("+"),text("Count 2"),text("Done")');
    t.engine.update({
      code: '__ui.render(__ui.jsx(()=>{throw new Error("boom")},null))',
    });
    expect(t.last()!.error).toEqual({ kind: "program", message: "Error: boom" });
    t.engine.trigger(`${btn.id}.onClick`);
    expect(applyBatches(t.batches).text).toBe('button("+"),text("Count 3"),text("Done")');
  });

  it("keeps the last good tree when a re-render throws", () => {
    const t = testEngine();
    t.load(
      '{@body const [n,setN] = useState(0)}\n{@body if (n === 1) throw new Error("boom")}\n<button onClick={()=>setN(1)}>x</button>\n<text>{n}</text>',
    );
    const btn = t.last()!.ops.find((o) => o.op === "create" && o.type === "button")!;
    t.engine.trigger(`${btn.id}.onClick`);
    expect(t.last()!.error?.kind).toBe("program");
    expect(applyBatches(t.batches).text).toBe('button("x"),text("0")');
  });

  it("stops a render loop and reports it", () => {
    const t = testEngine();
    t.load(
      "{@body const [n, setN] = useState(0)}\n{@body useEffect(() => setN((v) => v + 1))}\n<text>{n}</text>",
    );
    expect(t.last()!.error).toEqual({ kind: "render-loop", message: expect.any(String) });
    const settled = t.batches.length;
    t.update("<text>calm</text>");
    expect(t.batches.length).toBeLessThan(settled + 3);
  });

  it("reports handler errors separately from program errors", () => {
    const t = testEngine();
    t.load('<button onClick={() => { throw new Error("nope") }}>x</button>');
    const btn = t.last()!.ops.find((o) => o.op === "create")!;
    t.engine.trigger(`${btn.id}.onClick`);
    expect(t.last()!.error).toEqual({ kind: "handler", message: "Error: nope" });
  });

  it("escapes program data that looks like an encoded function or element", () => {
    const t = testEngine();
    t.load('<box data={{$fn: "1.onClick", $el: {type: "x"}, $$x: 1, ok: 2}}/>');
    const set = t.last()!.ops.find((o) => o.op === "set" && o.name === "data") as Extract<
      Op,
      { op: "set" }
    >;
    expect(set.value).toEqual({ $$fn: "1.onClick", $$el: { type: "x" }, $$$x: 1, ok: 2 });
  });

  it("runs actions only from event handlers, not from effects a click causes", () => {
    const calls: unknown[] = [];
    const t = testEngine({ callHost: (name, args) => calls.push([name, ...args]) });
    t.load(
      '{@body const [n, setN] = useState(0)}\n{@body useEffect(() => { action("send", "auto " + n) }, [n])}\n<button onClick={() => { setN(n + 1); action("send", "click") }}>Go</button>',
    );
    expect(calls).toEqual([]);
    const btn = t.batches.flatMap((b) => b.ops).find((o) => o.op === "create")!;
    t.engine.trigger(`${btn.id}.onClick`);
    expect(calls).toEqual([["send", "click"]]);
    expect(t.last().error?.kind).toBe("handler");
  });

  it("holds a streaming sentence until its values exist", () => {
    const src =
      "Intro.\n\nYour deposits grow to **{fmt(total)}** in {years} years.\n\n{@body const years = 20}";
    const t = testEngine();
    t.load(src, { progressive: true });
    expect(applyBatches(t.batches).text).toBe('text("Intro.")');
    t.update(src + '\n{@body const total = 1000}\n{@body const fmt = (n) => "$" + n}');
    expect(applyBatches(t.batches).text).toBe(
      'text("Intro."),text("Your deposits grow to ",bold("$1000")," in 20 years.")',
    );
    const done = testEngine();
    done.load(src);
    expect(applyBatches(done.batches).text).toBe(
      'text("Intro."),text("Your deposits grow to  in 20 years.")',
    );
  });

  it("shows no if branch while its condition waits on a list not written yet", () => {
    const src =
      "{@body const [i] = useState(0)}\n{#if i < items.length}<text>{items[i]}</text>{:else}<text>Done</text>{/if}";
    const t = testEngine();
    t.load(src, { progressive: true });
    expect(applyBatches(t.batches).text).toBe("");
    t.update(src + '\n{@body const items = ["Q1"]}');
    expect(applyBatches(t.batches).text).toBe('text("Q1")');
  });

  it("runs useTimeout callbacks on the host clock", () => {
    const timers = new Map<number, () => void>();
    let next = 0;
    const t = testEngine({
      setInterval: (fn) => (timers.set(++next, fn), next),
      clearInterval: (h) => timers.delete(h as number),
    });
    t.load(
      "{@body const [open, setOpen] = useState([])}\n{@body useTimeout(() => setOpen([]), open.length === 2 ? 800 : null)}\n<button onClick={() => setOpen([...open, open.length])}>Flip</button>\n<text>{open.length}</text>",
    );
    const btn = t.batches.flatMap((b) => b.ops).find((o) => o.op === "create")!;
    t.engine.trigger(`${btn.id}.onClick`);
    expect(timers.size).toBe(0);
    t.engine.trigger(`${btn.id}.onClick`);
    expect(applyBatches(t.batches).text).toBe('button("Flip"),text("2")');
    expect(timers.size).toBe(1);
    [...timers.values()][0]!();
    expect(applyBatches(t.batches).text).toBe('button("Flip"),text("0")');
    expect(timers.size).toBe(0);
  });

  it("keeps components inside element props mounted across renders", () => {
    // Written as compiled code: the language has no syntax for program-defined components.
    let mounts = 0;
    const t = testEngine({
      evaluate: (code, names, values) => {
        new Function("mounted", ...names, code)(() => mounts++, ...values);
      },
    });
    t.engine.load({
      code: `__ui.render(__ui.jsx(() => {
        const [n, setN] = useState(0);
        function Inner() { useEffect(() => { mounted() }, []); return "inner"; }
        return __ui.jsx("card", { header: __ui.jsx(Inner, null), onClick: () => setN(n + 1) });
      }, null));`,
    });
    const card = t.batches.flatMap((b) => b.ops).find((o) => o.op === "create")!;
    t.engine.trigger(`${card.id}.onClick`);
    t.engine.trigger(`${card.id}.onClick`);
    expect(mounts).toBe(1);
  });

  it("refuses output past the size budget", () => {
    const r = run('<text>{"x".repeat(7_000_000)}</text>');
    expect(r.last()!.error).toEqual({
      kind: "program",
      message: "Error: The rendered output is too large",
    });
  });
});
