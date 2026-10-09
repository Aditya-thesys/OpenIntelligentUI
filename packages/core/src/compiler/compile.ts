import { CodeGen } from "./codegen";
import { INTERNAL, MARKDOWN_TAGS } from "./language";
import {
  compileStatement,
  declaredNames,
  orderByDependencies,
  referencedNames,
  splitStatements,
} from "./statements";
import { tokenize, type Token } from "./tokenize";
import { buildTree, type Body } from "./tree";
import type { CompileOptions, CompileResult, Diagnostic } from "./types";

/** Compiles source, or any prefix of a stream of it, into a program for the runtime. */
export function compile(src: string, options: CompileOptions = {}): CompileResult {
  // A stream that ends in a heading's "#" marks has not written the heading's text yet.
  if (options.progressive) src = src.replace(/(^|\n)[ \t]*#{1,6}[ \t]*$/u, "$1");
  const { tokens, stop, unknownDirectives, partialName } = tokenize(
    src,
    options.progressive,
    options.components,
  );
  const { children, bodies, nestedBodies, openBlocks, tooDeep } = buildTree(tokens);

  let statements: Body[] = bodies.flatMap((b) =>
    splitStatements(b.value).map((value) => ({ value, pos: b.pos })),
  );
  // A list that seeds state must not be partial: useState keeps its first value.
  if (
    partialName &&
    statements.some(
      (s) => /\buseState\s*\(/.test(s.value) && referencedNames(s.value).has(partialName),
    )
  )
    statements = statements.slice(0, -1);

  const diagnostics: Diagnostic[] = [];
  const report = (code: Diagnostic["code"], pos: number, name?: string) =>
    diagnostics.push({
      code,
      action:
        code === "unclosed-block" || code.startsWith("unterminated") ? "recovered" : "dropped",
      ...lineColumn(src, pos),
      ...(name ? { name } : {}),
    });

  if (stop) report(stop.code, stop.pos, stop.name);
  else if (openBlocks.length) {
    const block = openBlocks[openBlocks.length - 1];
    report("unclosed-block", block.pos, block.kind);
  }
  for (const b of nestedBodies) report("body-in-block", b.pos);
  if (tooDeep !== null) report("too-deep", tooDeep);
  for (const u of unknownDirectives) report("unknown-directive", u.pos, u.name);

  // Models occasionally repeat a block; a redeclared name would make the program a SyntaxError.
  const declared = new Set<string>();
  const kept = statements.filter((stmt) => {
    const names = declaredNames(stmt.value);
    const clash = names.find((n) => declared.has(n));
    if (clash) report("duplicate-declaration", stmt.pos, clash);
    else names.forEach((n) => declared.add(n));
    return !clash;
  });

  const gen = new CodeGen(!!options.progressive);
  const ordered = options.orderStatements ? orderByDependencies(kept, (s) => s.value) : kept;
  const body = ordered.map((stmt) =>
    compileStatement(stmt.value, (code) => gen.guard(code, "undefined")),
  );
  const rootCode = gen.fragment(gen.children(children, false));
  const { jsx, constants } = INTERNAL;
  const code =
    gen.prelude() +
    `${jsx}.render(${jsx}.jsx(()=>{const ${constants}=${jsx}.useConstants();` +
    body.map((stmt) => `${stmt};\n`).join("") +
    `return ${rootCode};},null));`;

  return {
    code,
    constants: gen.constants,
    diagnostics,
    fallbackText: fallbackText(tokens),
  };
}

function lineColumn(src: string, pos: number): { line: number; column: number } {
  const before = src.slice(0, pos);
  return { line: before.split("\n").length, column: pos - before.lastIndexOf("\n") };
}

function fallbackText(tokens: Token[]): string {
  let out = "";
  for (const t of tokens) {
    if (t.kind === "text") out += t.value;
    else if (t.kind === "open" && t.tag === MARKDOWN_TAGS.codeBlock) out += `\n${t.attrs[0][2]}\n`;
  }
  return out
    .split("\n")
    .map((l) => l.trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
