import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { compile } from "../../compiler";
import { applyBatches, testEngine } from "./helpers";

/** Feeds the source in growing prefixes (like a stream), then the full source; the final tree must equal a fresh render. */
function streamThenCompare(src: string, step: number) {
  const s = testEngine();
  let loaded = false;
  for (let n = step; n < src.length + step; n += step) {
    const out = compile(src.slice(0, Math.min(n, src.length)), {
      progressive: n < src.length,
      orderStatements: true,
    });
    if (!loaded) {
      s.engine.load({ code: out.code, constants: out.constants });
      loaded = true;
    } else s.engine.update({ code: out.code, constants: out.constants });
  }
  const fresh = testEngine();
  const out = compile(src, { orderStatements: true });
  fresh.engine.load({ code: out.code, constants: out.constants });
  return {
    streamed: applyBatches(s.batches).text,
    fresh: applyBatches(fresh.batches).text,
    errors: s.batches.filter((b) => b.error).map((b) => b.error),
  };
}

const BUDGET = `Here's a budget.

{@body const [income,setIncome] = useState(5000)}
{@body const [expenses,setExpenses] = useState([{name:"Rent",amount:1500},{name:"Food",amount:600},{name:"Other",amount:300}])}
{@body const planned = expenses.reduce((s,e)=>s+e.amount,0)}
<box border padding={4} gap={3}>
  <title size="lg">Monthly budget</title>
  <row justify="between"><text>Take-home pay</text><input inputType="number" value={income} onChange={(v)=>setIncome(Number(v))} width={110}/></row>
  <divider/>
  {#each expenses as item, i}
    <row key={item.name} align="center" justify="between" gap={2}>
      <text flex={1}>{item.name}</text>
      <input inputType="number" value={item.amount} onChange={(value) => setExpenses(expenses.map((entry, index) => index === i ? {...entry, amount: Number(value)} : entry))} width={110}/>
    </row>
  {/each}
  <divider/>
  <row justify="between"><text>Planned</text><text tabularNums>\${planned.toLocaleString()}</text></row>
  <row justify="between"><text weight="semibold">Remaining</text><text color="success">\${(income-planned).toLocaleString()}</text></row>
</box>

Adjust any amount and the totals update.`;

describe("streaming prefixes end in the same tree as a fresh render", () => {
  for (const step of [1, 7, 24, 80]) {
    it(`budget, ${step} chars per update`, () => {
      const r = streamThenCompare(BUDGET, step);
      expect(r.streamed).toBe(r.fresh);
    });
  }

  // Set SAMPLES_DIR to a folder of saved answers to run this.
  const dir = process.env["SAMPLES_DIR"] ?? "";
  const samples = (fs.existsSync(dir) ? fs.readdirSync(dir) : [])
    .filter((f) => f.endsWith(".txt"))
    .map((f) => ({ name: f, src: fs.readFileSync(path.join(dir, f), "utf8") }));
  for (const { name, src } of samples)
    // Shuffled content differs between any two renders, so it cannot be compared.
    it.skipIf(/Math\.random/.test(src))(`sample ${name}`, { timeout: 180000 }, () => {
      for (const step of src.length > 6000 ? [11, 24] : [3, 24]) {
        const r = streamThenCompare(src, step);
        expect(r.streamed, `step ${step}`).toBe(r.fresh);
      }
    });

  it("keyed state keeps its value when statements are reordered between versions", () => {
    const a = compile(
      '{@body const [x,setX] = useState("x")}\n{@body const [y,setY] = useState("y")}\n<text>{x}{y}</text>',
    );
    const b = compile(
      '{@body const [y,setY] = useState("y")}\n{@body const [x,setX] = useState("x")}\n<text>{x}{y}</text>',
    );
    const s = testEngine();
    s.engine.load({ code: a.code, constants: a.constants });
    s.engine.update({ code: b.code, constants: b.constants });
    expect(applyBatches(s.batches).text).toBe('text("xy")');
  });
});
