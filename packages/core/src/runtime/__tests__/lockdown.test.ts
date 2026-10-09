import { describe, expect, it } from "vitest";
import { lockdown } from "../lockdown";

describe("lockdown", () => {
  it("refuses to continue when a global cannot be removed", () => {
    const scope: Record<string, unknown> = {};
    Object.defineProperty(scope, "fetch", { value: () => undefined, configurable: false });
    expect(() => lockdown(scope)).toThrow("sandbox lockdown failed for: fetch");
  });
});
