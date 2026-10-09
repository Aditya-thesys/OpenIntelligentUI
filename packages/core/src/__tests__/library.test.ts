import { describe, expect, it } from "vitest";
import { z } from "zod/v4";
import {
  callback,
  createLibrary,
  defineComponent,
  slot,
  tagSchemaId,
  validateProps,
} from "../index";

const Dummy = null;

const Title = defineComponent({
  name: "title",
  props: z.object({ size: z.enum(["sm", "md", "lg"]).optional(), children: slot() }),
  description: "Heading text",
  component: Dummy,
});

const Slider = defineComponent({
  name: "slider",
  props: z.object({
    min: z.number(),
    max: z.number(),
    step: z.number().optional(),
    value: z.number(),
    disabled: z.boolean().optional(),
    onChange: callback({ params: "value: number" }),
  }),
  description: "Numeric slider",
  component: Dummy,
});

const Card = defineComponent({
  name: "card",
  props: z.object({ header: Title.ref.optional(), children: slot() }),
  description: "Bordered container",
  component: Dummy,
});

const Table = defineComponent({
  name: "table",
  props: z.object({ children: z.array(z.union([Title.ref, Card.ref])) }),
  description: "Rows",
  component: Dummy,
});

const library = createLibrary({
  components: [Title, Slider, Card, Table],
  componentGroups: [{ name: "Inputs", components: ["slider"], notes: ["- Prefer sliders."] }],
});

const isNode = (v: unknown) => typeof v === "object" && v !== null && "element" in v;

describe("prompt", () => {
  const prompt = library.prompt({
    preamble: "You build tools.",
    additionalRules: ["Keep it short."],
    examples: ["<title>Hi</title>"],
    actions: [{ name: "openUrl", params: "url: string", description: "Opens a link" }],
  });

  it("renders signatures in tag syntax", () => {
    expect(prompt).toContain(
      "- `<slider min={number} max={number} step?={number} value={number} disabled? onChange={(value: number) => …}/>`: Numeric slider",
    );
    expect(prompt).toContain('- `<title size?="sm|md|lg">…</title>`: Heading text');
    expect(prompt).toContain("- `<card header?={<title/>}>…</card>`");
    expect(prompt).toContain("- `<table><title/>|<card/>…</table>`");
  });

  it("groups components and adds options", () => {
    expect(prompt.startsWith("You build tools.")).toBe(true);
    expect(prompt).toMatch(/### Inputs\n- `<slider[^\n]+\n- Prefer sliders\.\n\n### Other/);
    expect(prompt).toContain('`action("openUrl", url: string)`: Opens a link');
    expect(prompt).toContain("--- Example 1 ---\n<title>Hi</title>\n--- End ---");
    expect(prompt).toContain("## Rules\n- Keep it short.");
  });

  it("serializes to JSON schema with callbacks and slots marked", () => {
    const slider = library.toJSONSchema().$defs?.["slider"] as {
      description?: string;
      properties: Record<string, Record<string, unknown>>;
    };
    expect(slider.description).toBe("Numeric slider");
    expect(slider.properties["onChange"]?.["x-callback"]).toBe("value: number");
    expect(library.toSpec().components["card"]?.signature).toContain("<card");
  });

  it("shows tagged schemas by name", () => {
    const stop = z.object({ name: z.string(), lat: z.number() });
    tagSchemaId(stop, "Stop");
    const Map = defineComponent({
      name: "Map",
      props: z.object({ stops: z.array(stop), tags: z.array(z.enum(["a", "b"])) }),
      description: "Map",
      component: Dummy,
    });
    const prompt = createLibrary({ components: [Map] }).prompt();
    expect(prompt).toContain('`<Map stops={Stop[]} tags={("a"|"b")[]}/>`');
    expect(prompt).toContain("### Types\n- `Stop = {name: string, lat: number}`");
  });

  it("names a ref to a component outside the library and accepts nodes for it", () => {
    const Panel = defineComponent({
      name: "panel",
      props: z.object({ head: Title.ref }),
      description: "Panel",
      component: Dummy,
    });
    expect(createLibrary({ components: [Panel] }).prompt()).toContain("`<panel head={<title/>}/>`");
    expect(validateProps(Panel.props, { head: { element: true } }, { isNode }).omit).toBe(false);
  });

  it("spreads an earlier component and lists the props it changes", () => {
    const shared = { a: z.string(), b: z.string(), c: z.string(), d: z.string() };
    const Base = defineComponent({
      name: "base",
      props: z.object({ ...shared, size: z.enum(["s", "m"]) }),
      description: "Base",
      component: Dummy,
    });
    const Big = defineComponent({
      name: "big",
      props: z.object({ ...shared, size: z.enum(["l", "xl"]) }),
      description: "Big",
      component: Dummy,
    });
    expect(createLibrary({ components: [Base, Big] }).prompt()).toContain(
      '`<big {...base} size="l|xl"/>`',
    );
  });

  it("teaches app data only when described", () => {
    expect(library.prompt()).not.toContain("useAppData");
    expect(library.prompt({ appData: "the user's accounts" })).toContain(
      "useAppData()` returns read-only data from the app: the user's accounts",
    );
  });

  it("rejects groups that list unknown components", () => {
    expect(() =>
      createLibrary({
        components: [Title],
        componentGroups: [{ name: "X", components: ["nope"] }],
      }),
    ).toThrow(/unknown component "nope"/);
  });

  it("lets a later component replace an earlier one with the same name", () => {
    const Other = defineComponent({
      name: "title",
      props: z.object({ text: z.string() }),
      description: "Replacement",
      component: Dummy,
    });
    const lib = createLibrary({ components: [Title, Other] });
    expect(lib.components["title"]?.description).toBe("Replacement");
  });
});

describe("validateProps", () => {
  const validate = (schema: z.ZodObject, props: Record<string, unknown>) =>
    validateProps(schema, props, { isNode });

  it("passes only declared props unless the schema is loose", () => {
    const onChange = () => {};
    const out = validate(Slider.props, { min: 0, max: 10, value: 3, onChange, style: "x" });
    expect(out).toEqual({
      props: { min: 0, max: 10, value: 3, onChange },
      issues: [],
      omit: false,
    });
    const loose = z.looseObject({ r: z.number() });
    expect(validate(loose, { r: 2, fill: "red" }).props).toEqual({ r: 2, fill: "red" });
  });

  it("drops an invalid optional prop", () => {
    const out = validate(Slider.props, {
      min: 0,
      max: 10,
      value: 3,
      onChange: () => {},
      step: "x",
    });
    expect(out.props).not.toHaveProperty("step");
    expect(out.omit).toBe(false);
    expect(out.issues).toEqual([expect.objectContaining({ code: "type-mismatch", prop: "step" })]);
  });

  it("omits the node when a required prop is missing or invalid", () => {
    const out = validate(Slider.props, { min: 0, max: 10, onChange: "nope" });
    expect(out.omit).toBe(true);
    expect(out.issues.map((i) => [i.code, i.prop])).toEqual([
      ["missing-required", "value"],
      ["type-mismatch", "onChange"],
    ]);
  });

  it("accepts rendered content for slot and ref props", () => {
    expect(validate(Card.props, { header: { element: true } }).omit).toBe(false);
    expect(validate(Card.props, { header: { x: 1 } }).issues[0]?.code).toBe("type-mismatch");
  });

  it("treats null as not set for optional props", () => {
    const out = validate(Slider.props, {
      min: 0,
      max: 1,
      value: 0,
      onChange: () => {},
      step: null,
    });
    expect(out.props).not.toHaveProperty("step");
    expect(out.issues).toEqual([]);
  });
});
