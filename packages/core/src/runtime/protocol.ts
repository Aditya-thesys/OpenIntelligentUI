import type { Batch } from "./engine";

export type ToWorker =
  | {
      type: "load";
      seq: number;
      code: string;
      constants?: Record<string, unknown>;
      appData?: unknown;
      state?: Record<string, unknown>;
    }
  | { type: "update"; seq: number; code: string; constants?: Record<string, unknown> }
  | { type: "setData"; seq: number; appData: unknown }
  | { type: "setState"; seq: number; state: Record<string, unknown> }
  | { type: "trigger"; seq: number; slot: string; args: unknown[] }
  | { type: "ping"; seq: number };

export type FromWorker =
  | { type: "batch"; batch: Batch }
  | { type: "persist"; state: Record<string, unknown> }
  | { type: "host"; name: string; args: unknown[] }
  | { type: "done"; seq: number };

export type FromSandbox = FromWorker | { type: "restarted"; reason: string; quarantined: boolean };
