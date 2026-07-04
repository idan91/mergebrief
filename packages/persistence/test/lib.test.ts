import { describe, expect, it } from "vitest";
import { createDb, forTenant, parseTenantContext } from "../src/lib.js";

describe("persistence package surface", () => {
  it("exposes the tenant repository factory and context boundary", () => {
    expect(typeof forTenant).toBe("function");
    expect(typeof createDb).toBe("function");
    expect(typeof parseTenantContext).toBe("function");
  });
});
