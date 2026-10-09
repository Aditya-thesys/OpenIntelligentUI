import type { DiagnosticCode } from "@open-intelligent-ui/core/compiler";

/** Error codes; those shared with OpenUI Lang keep its names. */
export type OpenUIErrorCode =
  | DiagnosticCode
  | "unknown-component"
  | "missing-required"
  | "type-mismatch"
  | "render-error"
  | "runtime-error"
  | "handler-error"
  | "effect-error"
  | "render-loop"
  | "undefined-name"
  | "sandbox-restarted"
  | "sandbox-quarantined";

/** A problem with the response, in the shape of OpenUI Lang's `OpenUIError`. */
export interface OpenUIError {
  source: "parser" | "runtime";
  code: OpenUIErrorCode;
  message: string;
  component?: string;
  path?: string;
  hint?: string;
}
