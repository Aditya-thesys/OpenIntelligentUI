import { describe, expect, it } from "vitest";
import { compile } from "../index";

const HEAD = "__ui.render(__ui.jsx(()=>{const __constants=__ui.useConstants();";
const strip = (code: string) => code.replace(/^(function [^\n]*\n)+\n/, "").replace(HEAD, "");

describe("compile rules", () => {
  it("keys useState and guards derived values", () => {
    const { code } = compile(
      "{@body const [n,setN] = useState(8)}\n{@body const d = n*2}\n<title>{d}</title>",
    );
    expect(strip(code)).toBe(
      `const [n,setN] = useState(__safe(()=>(8),undefined),{key:"n"});\nconst d = __safe(()=>(n*2),undefined);\nreturn __safe(()=>(__ui.jsx("title",null,d)),null);},null));`,
    );
  });

  it("turns markdown into text, title and bold nodes with hoisted constants", () => {
    const out = compile("## Hello\n\nSome **bold** words.");
    expect(strip(out.code)).toBe(
      'return __ui.jsx(__ui.Fragment,null,__ui.jsx("title",{"size":"lg"},__constants["0"]),__ui.jsx("text",null,__constants["1"],__ui.jsx("bold",null,__constants["2"]),__constants["3"]));},null));',
    );
    expect(out.constants).toEqual({ 0: "Hello", 1: "Some ", 2: "bold", 3: " words." });
  });

  it("compiles each and if blocks", () => {
    const { code } = compile(
      "{#each items as it,i}<text>{it}</text>{/each}{#if a}<badge>A</badge>{:else if b}<badge>B</badge>{:else}<badge>C</badge>{/if}",
    );
    expect(strip(code)).toContain(
      '__safe(()=>((items).map((it,i)=>__safe(()=>(__safe(()=>(__ui.jsx("text",null,it)),null)),null))),[])',
    );
    expect(strip(code)).toContain(
      '(__safe(()=>(a),false))?__ui.jsx("badge",null,__constants["0"]):(__safe(()=>(b),false))?',
    );
  });

  it("hoists static literals and inlines dynamic props", () => {
    const out = compile('<select value={v} onChange={setV} options={[{label:"A",value:"a"}]}/>');
    expect(strip(out.code)).toBe(
      'return __safe(()=>(__ui.jsx("select",{"value":v,"onChange":setV,"options":__constants["0"]})),null);},null));',
    );
    expect(out.constants["0"]).toEqual([{ label: "A", value: "a" }]);
  });

  it("drops an unfinished statement and reports it", () => {
    const out = compile("{@body const [n,setN] = useState(1)}\n{@body const x = n+");
    expect(out.code).toContain('useState(__safe(()=>(1),undefined),{key:"n"});\nreturn');
    expect(out.diagnostics[0]).toMatchObject({
      code: "unterminated-braced-value",
      line: 2,
      column: 1,
    });
  });

  it("drops an unfinished tag and keeps open elements with content", () => {
    const out = compile("<box gap={2}>\n  <text>Hi</text>\n  <slider value={");
    expect(strip(out.code)).toBe(
      'return __ui.jsx("box",{"gap":2},__ui.jsx("text",null,__constants["0"]));},null));',
    );
    expect(out.diagnostics[0].code).toBe("unterminated-tag");
  });

  it("prunes open elements that have no content yet", () => {
    const out = compile("Intro\n\n<box>\n  <row>");
    expect(strip(out.code)).toBe('return __ui.jsx("text",null,__constants["0"]);},null));');
  });

  it("accepts the keyed each form and ignores the key", () => {
    const keyed = compile("{#each items as item, i (item.id)}<text>{item.name}</text>{/each}");
    const plain = compile("{#each items as item, i}<text>{item.name}</text>{/each}");
    expect(keyed.code).toBe(plain.code);
    expect(keyed.diagnostics).toEqual([]);
  });

  it("drops an unknown block directive instead of emitting invalid code", () => {
    const out = compile("<box>{#await load()}<text>Hi</text></box>");
    expect(out.code).not.toContain("#await");
    expect(out.diagnostics).toContainEqual(
      expect.objectContaining({ code: "unknown-directive", action: "dropped", name: "await" }),
    );
    const prose = compile("A {@const x = 1} {#If x} {a: 1} B");
    expect(() => new Function("__ui", prose.code)).not.toThrow();
    expect(prose.diagnostics.map((d) => d.name)).toEqual(["const", "If"]);
    expect(Object.values(prose.constants).join("")).toContain("{a: 1}");
  });

  it("progressive mode keeps the complete items of a streaming array", () => {
    const src =
      '<text>{items.length}</text>\n{@body const items = [{n:"a",t:"x, y"},{n:"b",t:`p,${1}`},{n:"c"';
    expect(compile(src).code).not.toContain("const items");
    const out = compile(src, { progressive: true });
    expect(out.code).toContain(
      'const items = __safe(()=>([{n:"a",t:"x, y"},{n:"b",t:`p,${1}`}]),undefined)',
    );
    expect(out.diagnostics[0].code).toBe("unterminated-braced-value");
  });

  it("progressive mode never touches useState initial values", () => {
    const out = compile('{@body const [items,setItems] = useState([{n:"a"},{n:', {
      progressive: true,
    });
    expect(out.code).not.toContain("useState");
  });

  it("ends a Markdown heading at its line", () => {
    const out = compile("## Focus sprint\nSet a target.");
    expect(out.code).toContain('__ui.jsx("title",{"size":"lg"},__constants["0"])');
    expect(out.code).toContain('__ui.jsx("text",null,__constants["1"])');
  });

  it("drops a statement that redeclares an earlier name instead of breaking the program", () => {
    const out = compile(
      "{@body const [a,setA] = useState(1)}\n{@body const b = a+1}\n<text>{b}</text>\n{@body const [a,setA] = useState(1)}",
    );
    expect(out.code.match(/useState\(/g)).toHaveLength(1);
    expect(out.diagnostics).toContainEqual(
      expect.objectContaining({ code: "duplicate-declaration", name: "a" }),
    );
    expect(() => new Function("useState", "__ui", out.code)).not.toThrow();
    const nested = compile(
      "{@body const { a: { b }, c = 1 } = x}\n{@body const [[d, e], ...f] = y}\n{@body const b = 1}\n{@body const e = 1}\n{@body const f = 1}",
    );
    expect(nested.diagnostics.map((d) => d.name)).toEqual(["b", "e", "f"]);
  });

  it("progressive mode renders a streaming component with its finished attributes", () => {
    const src =
      'Menu\n<RecipePlanner title="Dinner" baseGuests={8} ingredients={[{name:"Salmon",quantity:1.6,unit:"kg"},{name:"Lemons",quant';
    expect(compile(src).code).not.toContain("RecipePlanner");
    const out = compile(src, { progressive: true });
    expect(out.code).toContain('__ui.jsx("RecipePlanner",');
    expect(Object.values(out.constants)).toContainEqual([
      { name: "Salmon", quantity: 1.6, unit: "kg" },
    ]);
  });

  it("supports Markdown italics but not math", () => {
    expect(compile("Watch the *trend* closely.").code).toContain('__ui.jsx("italic",null,');
    expect(compile("It is 2*3*4 units.").code).not.toContain("italic");
  });

  it("orders statements by dependency when asked", () => {
    const src =
      '{@body const [deck,setDeck] = useState(() => shuffle())}\n<text>{deck.length}</text>\n{@body const shuffle = () => [...names, ...names]}\n{@body const names = ["a","b"]}';
    const plain = compile(src).code;
    expect(plain.indexOf("useState")).toBeLessThan(plain.indexOf("const shuffle"));
    const out = compile(src, { orderStatements: true }).code;
    expect(out.indexOf("const names")).toBeLessThan(out.indexOf("const shuffle"));
    expect(out.indexOf("const shuffle")).toBeLessThan(out.indexOf("useState"));
  });

  it("compiles statement shapes models write", () => {
    const sources = [
      "{@body const a = 1;}",
      "{@body const a = 1; const b = 2}",
      "{@body const [n,setN] = useState()}",
      "{@body let [n,setN] = useState(0);}",
      "{@body const [a,setA] = useState(1); const [b,setB] = useState(2)}",
      "{@body if (x) f(); else g()}",
      "{@body // don't\nconst a = 1}",
      "{@body const a = 1, b = f(1, 2)}",
      "{@body const a = [1]}\n{@body [1, 2].forEach(f)}\n{@body (() => a)()}",
    ];
    for (const src of sources) {
      const out = compile(src);
      expect(() => new Function("__ui", "useState", out.code), src).not.toThrow();
      expect(out.diagnostics, src).toEqual([]);
    }
    const two = compile(sources[4]).code;
    expect(two).toContain('useState(__safe(()=>(1),undefined),{key:"a"})');
    expect(two).toContain('useState(__safe(()=>(2),undefined),{key:"b"})');
    expect(compile(sources[2]).code).toContain('useState(undefined,{key:"n"})');
    expect(compile(sources[8]).code).toContain(";\n[1, 2].forEach(f);\n(() => a)();\n");
    expect(compile(sources[7]).code).toContain(
      "const a = __safe(()=>(1),undefined), b = __safe(()=>(f(1, 2)),undefined)",
    );
  });

  it("compiles Markdown lists, links, code, rules and tables with expressions", () => {
    const out = compile(
      "Steps:\n- one\n- two\n\n1. First\n\nSee [docs](https://a.b) and `x {y}`.\n\n---\n\n```js\nf({ a: 1 })\n```\n| a | b |\n|-|-|\n| {n} | 2 |",
    );
    const code = strip(out.code);
    expect(code).toContain('__ui.jsx("list",null,__ui.jsx("list-item",null,');
    expect(code).toContain('__ui.jsx("list",{"ordered":true}');
    expect(code).toContain('__ui.jsx("link",{"href":"https://a.b"}');
    expect(compile("[w](https://w.org/Foo_(bar)) now").code).toContain(
      '"href":"https://w.org/Foo_(bar)"',
    );
    expect(code).toContain('__ui.jsx("divider",null)');
    expect(code).toContain('__ui.jsx("code-block",{"code":"f({ a: 1 })","language":"js"})');
    expect(code).toContain(
      '__ui.jsx("table-cell",null,__ui.jsx("text",null,__safe(()=>(n),null)))',
    );
    expect(Object.values(out.constants)).toContain("x {y}");
  });

  it("nests indented Markdown lists", () => {
    const code = strip(compile("- Fruit\n  - Apple\n- Veg\n  1. Leek\n- Nuts").code);
    expect(code).toContain(
      '__ui.jsx("list-item",null,__constants["0"],__ui.jsx("list",null,__ui.jsx("list-item",null,__constants["1"])))',
    );
    expect(code).toContain(
      '__ui.jsx("list",{"ordered":true},__ui.jsx("list-item",null,__constants["3"]))),',
    );
  });

  it("closes a code block indented under a list item and resumes the numbering", () => {
    const out = compile(
      "1. Create it:\n   ```bash\n   python -m venv .venv\n   ```\n2. **Activate** it",
    );
    const code = strip(out.code);
    expect(code).toContain('"code":"python -m venv .venv","language":"bash"');
    expect(code).toContain('__ui.jsx("list",{"ordered":true,"start":2}');
    expect(code).toContain('__ui.jsx("bold"');
  });

  it("keeps an inline tag inside its sentence", () => {
    expect(strip(compile("Status: <badge>new</badge> today.\n<badge>alone</badge>").code)).toBe(
      'return __ui.jsx(__ui.Fragment,null,__ui.jsx("text",null,__constants["0"],__ui.jsx("badge",null,__constants["1"]),__constants["2"]),__ui.jsx("badge",null,__constants["3"]));},null));',
    );
  });

  it("treats backslash-escaped punctuation as literal text", () => {
    const out = compile("\\*Battery* figures are 2\\*3");
    expect(out.code).not.toContain("italic");
    expect(Object.values(out.constants).join("")).toBe("*Battery* figures are 2*3");
  });

  it("waits for a streaming heading's text before showing its marks", () => {
    expect(compile("Intro.\n\n##", { progressive: true }).constants).toEqual({ 0: "Intro." });
    expect(compile("#", { progressive: true }).constants).toEqual({});
  });

  it("keeps text after a stray `<` and reads loose syntax", () => {
    expect(compile("Is a<b true? Yes.").constants).toEqual({ 0: "Is a<b true? Yes." });
    const prose = compile("Press <Enter> or <Tab/>.", { components: new Set(["Panel"]) });
    expect(prose.constants).toEqual({ 0: "Press <Enter> or", 1: "." });
    expect(prose.code).toContain('__ui.jsx("Tab",null)');
    expect(compile("<badge tone='ok'>Hi</badge>").code).toContain('{"tone":"ok"}');
    expect(compile("{#if a}A{:elseif b}B{/if}").code).toContain("(__safe(()=>(b),false))?");
    expect(compile("{#each xs as {name}}<text>{name}</text>{/each}").code).toContain(
      "(xs).map(({name})=>",
    );
    const nested = compile("<box>\n{#each xs as x}{@body const y = x}{/each}</box>");
    expect(nested.diagnostics).toEqual([
      { code: "body-in-block", action: "dropped", line: 2, column: 16 },
    ]);
  });

  it("keeps code valid when model code ends in a comment", () => {
    const sources = [
      "{@body const a = 1 // note\n}\n<text>{a // x\n}</text>",
      "{@body const [n, setN] = useState(3) // default}\n<slider value={n // x\n}/>",
      "{#each xs // list\n as x}<text>{x}</text>{/each}{#if a // c\n}A{/if}",
    ];
    for (const src of sources) {
      const out = compile(src);
      expect(() => new Function("__ui", "useState", out.code), src).not.toThrow();
      expect(out.diagnostics, src).toEqual([]);
    }
    expect(compile("{/* Header */}{}Hi").constants).toEqual({ 0: "Hi" });
  });

  it("drops elements nested past the depth limit", () => {
    const out = compile("<box>".repeat(3000) + "x" + "</box>".repeat(3000) + "\nAfter");
    expect(out.diagnostics.map((d) => d.code)).toEqual(["too-deep"]);
    expect(out.code.split('"box"').length - 1).toBe(100);
    expect(Object.values(out.constants)).toContain("After");
  });

  it("skips regex literals that hold quotes or braces", () => {
    const out = compile('<text>{s.replace(/\'/g, "")} {s.replace(/[{"]/, "")}</text>\nAfter');
    expect(out.diagnostics).toEqual([]);
    expect(out.constants).toEqual({ 0: " ", 1: "After" });
    expect(compile("<text>{a / b} {c / d}</text>").code).toContain("(a / b)");
  });
});
