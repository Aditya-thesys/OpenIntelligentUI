import { findTopLevel, IDENT } from "./scan";

const DECLARATION = /^(?:const|let|var|(?:async\s+)?function)\b/;

export function declaredNames(stmt: string): string[] {
  const s = stmt.trim();
  const fn = new RegExp(`^(?:async\\s+)?function\\s*\\*?\\s*(${IDENT}+)`, "u").exec(s);
  if (fn) return [fn[1]];
  const m = /^(?:const|let|var)\s+/.exec(s);
  if (!m) return [];
  return splitTopLevel(s.slice(m[0].length)).flatMap((part) =>
    patternNames(part.slice(0, findTopLevel(part, 0, "=") ?? part.length)),
  );
}

// Names bound by a binding pattern such as `{ a: { b }, c = 1, ...d }` or `[[a, b], c]`.
function patternNames(pattern: string): string[] {
  const p = pattern.trim().replace(/^\.\.\./, "");
  if (p[0] !== "[" && p[0] !== "{") {
    const id = new RegExp(`^${IDENT}+`, "u").exec(p);
    return id ? [id[0]] : [];
  }
  return splitTopLevel(p.slice(1, -1)).flatMap((part) => {
    part = part.slice(0, findTopLevel(part, 0, "=") ?? part.length);
    if (p[0] === "{") part = part.slice((findTopLevel(part, 0, ":") ?? -1) + 1);
    return patternNames(part);
  });
}

function splitTopLevel(src: string): string[] {
  const parts: string[] = [];
  let start = 0;
  for (let at = findTopLevel(src, 0, ","); at !== null; at = findTopLevel(src, start, ",")) {
    parts.push(src.slice(start, at));
    start = at + 1;
  }
  parts.push(src.slice(start));
  return parts;
}

// `const a = 1; const b = 2` becomes two declarations; anything else with a top-level `;`
// (an `if ... else`) stays whole.
export function splitStatements(body: string): string[] {
  const parts: string[] = [];
  let start = 0;
  for (let at = findTopLevel(body, 0, ";"); at !== null; at = findTopLevel(body, start, ";")) {
    parts.push(body.slice(start, at).trim());
    start = at + 1;
  }
  parts.push(body.slice(start).trim());
  const statements = parts.filter(Boolean);
  if (statements.length > 1 && !statements.every((s) => DECLARATION.test(s)))
    return [statements.join("; ")];
  return statements;
}

// Approximate by design: it only drives statement ordering.
export function referencedNames(stmt: string): Set<string> {
  // `...name` is a reference, so the spread must not read as a property access.
  const code = stmt.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, '""').replace(/\.\.\./g, " ");
  const out = new Set<string>();
  for (const m of code.matchAll(new RegExp(`(?<![.\\p{L}\\p{N}_$])(${IDENT}+)`, "gu"))) {
    const before = code.slice(0, m.index).trimEnd().slice(-1);
    const after = code.slice(m.index + m[1].length).trimStart()[0];
    if ((before === "{" || before === ",") && after === ":") continue;
    out.add(m[1]);
  }
  return out;
}

// Stable; cycles keep the written order.
export function orderByDependencies<T>(items: T[], text: (item: T) => string): T[] {
  const stmts = items.map(text);
  const declared = stmts.map(declaredNames);
  const owner = new Map<string, number>();
  declared.forEach((names, i) => names.forEach((n) => owner.has(n) || owner.set(n, i)));
  const deps = stmts.map((stmt, i) => {
    const own = new Set(declared[i]);
    const d = new Set<number>();
    for (const name of referencedNames(stmt)) {
      const j = owner.get(name);
      if (j !== undefined && j !== i && !own.has(name)) d.add(j);
    }
    return d;
  });
  const done = new Set<number>();
  const out: number[] = [];
  while (out.length < stmts.length) {
    const ready = stmts.findIndex((_, i) => !done.has(i) && [...deps[i]].every((j) => done.has(j)));
    const next = ready >= 0 ? ready : stmts.findIndex((_, i) => !done.has(i));
    done.add(next);
    out.push(next);
  }
  return out.map((i) => items[i]);
}

const USE_STATE = new RegExp(
  `^(?:const|let)\\s+\\[\\s*(${IDENT}+)\\s*,\\s*${IDENT}+\\s*\\]\\s*=\\s*useState\\s*\\(`,
  "u",
);
const DECLARATOR = new RegExp(`^(\\s*${IDENT}+\\s*=\\s*)([\\s\\S]*)$`, "u");

// `useState` is keyed by its variable name so state survives statements being reordered between
// streamed versions; initializers are guarded so one failing value does not stop the program.
export function compileStatement(stmt: string, guard: (code: string) => string): string {
  const state = USE_STATE.exec(stmt);
  const close = state ? findTopLevel(stmt, state[0].length, ")") : null;
  if (state && close !== null && !stmt.slice(close + 1).trim()) {
    const init = stmt.slice(state[0].length, close).trim();
    return `${state[0]}${init ? guard(init) : "undefined"},{key:"${state[1]}"})`;
  }
  if (!/^const\s/.test(stmt) || findTopLevel(stmt, 0, ";") !== null) return stmt;
  const declarators = splitTopLevel(stmt.slice(5)).map((part) => DECLARATOR.exec(part));
  if (!declarators.every((d) => d !== null)) return stmt;
  return `const${declarators.map((d) => `${d[1]}${guard(d[2])}`).join(",")}`;
}
