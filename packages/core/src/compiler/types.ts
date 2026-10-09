export type DiagnosticCode =
  | "unterminated-braced-value"
  | "unterminated-tag"
  | "unclosed-block"
  | "unknown-directive"
  | "duplicate-declaration"
  | "body-in-block"
  | "too-deep";

export interface Diagnostic {
  code: DiagnosticCode;
  /** `recovered`: the source was cut at this point; `dropped`: one construct was skipped. */
  action: "recovered" | "dropped";
  line: number;
  column: number;
  /** Directive or declared name the diagnostic is about, when there is one. */
  name?: string;
}

export interface CompileResult {
  code: string;
  constants: Record<string, unknown>;
  diagnostics: Diagnostic[];
  /** Plain text of the static parts, for when the program cannot run. */
  fallbackText: string;
}

export interface CompileOptions {
  /** Streaming: render lists item by item, and hold sentences whose values do not exist yet. */
  progressive?: boolean;
  /** Run each `{@body}` statement after the declarations it uses, wherever it was written. */
  orderStatements?: boolean;
  /** Component names the library defines; any other capitalized `<Name>` is read as text. */
  components?: ReadonlySet<string>;
}
