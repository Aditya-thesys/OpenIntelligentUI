export const IDENT = "[\\p{L}\\p{N}_$]";
export const WORD = "[\\p{L}\\p{N}_]";

/** Index after the `}` matching `src[start]`, or null when unterminated. */
export function scanBraced(src: string, start: number): number | null {
  let depth = 0;
  let j = start;
  while (j < src.length) {
    const skipped = skipLiteral(src, j, start);
    if (skipped === null) return null;
    if (skipped > j) {
      j = skipped;
      continue;
    }
    if (src[j] === "{") depth++;
    else if (src[j] === "}" && --depth === 0) return j + 1;
    j++;
  }
  return null;
}

export function findTopLevel(src: string, start: number, chars: string): number | null {
  let depth = 0;
  let j = start;
  while (j < src.length) {
    const skipped = skipLiteral(src, j, 0);
    if (skipped === null) return null;
    if (skipped > j) {
      j = skipped;
      continue;
    }
    const c = src[j];
    if (depth === 0 && chars.includes(c)) return j;
    if ("([{".includes(c)) depth++;
    else if (")]}".includes(c)) depth--;
    j++;
  }
  return null;
}

/** The complete top-level items of an unfinished array literal, as `[a, b]`. */
export function partialArray(src: string): string | null {
  if (src[0] !== "[") return null;
  let depth = 0;
  let lastComplete = 1;
  let j = 1;
  while (j < src.length) {
    const skipped = skipLiteral(src, j, 0);
    if (skipped === null || skipped > src.length) break;
    if (skipped > j) {
      j = skipped;
      continue;
    }
    const c = src[j];
    if ("([{".includes(c)) depth++;
    else if (")]}".includes(c)) {
      if (depth === 0) return null;
      depth--;
    } else if (c === "," && depth === 0) lastComplete = j;
    j++;
  }
  return `[${src.slice(1, lastComplete).trim()}]`;
}

/** `code` without its comments, so nothing spliced after it can end up inside one. */
export function stripComments(code: string): string {
  let out = "";
  let last = 0;
  let j = 0;
  while (j < code.length) {
    const skipped = skipLiteral(code, j, 0);
    if (skipped === null) break;
    if (skipped === j) j++;
    else {
      if (code[j] === "/" && (code[j + 1] === "/" || code[j + 1] === "*")) {
        out += code.slice(last, j) + (code[j + 1] === "*" ? " " : "");
        last = skipped;
      }
      j = skipped;
    }
  }
  return out + code.slice(last);
}

// `from` is where the braced value opened.
function skipLiteral(src: string, j: number, from: number): number | null {
  const c = src[j];
  if (c === '"' || c === "'") return skipQuoted(src, j);
  if (c === "`") return skipTemplate(src, j);
  // `//` after `:` is a URL in a string-less expression, not a comment.
  if (c === "/" && src[j + 1] === "/" && src[j - 1] !== ":") {
    const nl = src.indexOf("\n", j);
    const end = nl < 0 ? src.length : nl;
    // Models write `{a // note}` on one line meaning the brace to close the value. Once the
    // value spans lines, as a function in `{@body}` does, the comment runs to the line end.
    const close = src.indexOf("}", j);
    return close >= 0 && close < end && !src.slice(from, j).includes("\n") ? close : end;
  }
  if (c === "/" && src[j + 1] === "*") {
    const end = src.indexOf("*/", j + 2);
    return end < 0 ? src.length : end + 2;
  }
  if (c === "/" && startsRegex(src, j)) return skipRegex(src, j);
  return j;
}

// A `/` starts a regex where a value is expected, as after `(`, `=` or `return`, but not a
// closing directive such as `{/each}`.
function startsRegex(src: string, j: number): boolean {
  let k = j - 1;
  while (k >= 0 && /\s/u.test(src[k])) k--;
  if (src[k] === "{" && /^\/\w+\s*\}/u.test(src.slice(j, j + 12))) return false;
  if (k < 0 || "(,=:[!&|?{};+-*%<>~^".includes(src[k])) return true;
  return /(?:^|[^\p{L}\p{N}_$])(?:return|typeof)$/u.test(src.slice(Math.max(0, k - 6), k + 1));
}

// A regex cannot span lines, so a `/` with no closing one on its line is left as division.
function skipRegex(src: string, start: number): number {
  let inClass = false;
  for (let j = start + 1; j < src.length && src[j] !== "\n"; j++) {
    const c = src[j];
    if (c === "\\") j++;
    else if (c === "[") inClass = true;
    else if (c === "]") inClass = false;
    else if (c === "/" && !inClass) {
      for (j++; /\w/u.test(src[j] ?? ""); j++);
      return j;
    }
  }
  return start;
}

function skipQuoted(src: string, start: number): number {
  const quote = src[start];
  let j = start + 1;
  while (j < src.length && src[j] !== quote) {
    if (src[j] === "\\") j++;
    j++;
  }
  return j + 1;
}

function skipTemplate(src: string, start: number): number | null {
  let j = start + 1;
  while (j < src.length) {
    if (src[j] === "\\") {
      j += 2;
      continue;
    }
    if (src[j] === "$" && src[j + 1] === "{") {
      const end = scanBraced(src, j + 1);
      if (end === null) return null;
      j = end;
      continue;
    }
    if (src[j] === "`") return j + 1;
    j++;
  }
  return null;
}
