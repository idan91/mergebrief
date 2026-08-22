import { describe, expect, it } from "vitest";
import { createDb, createTenantRepository, parseTenantContext } from "../src/index";

describe("persistence package surface", () => {
  it("exposes the tenant repository factory and context boundary", () => {
    expect(typeof createTenantRepository).toBe("function");
    expect(typeof createDb).toBe("function");
    expect(typeof parseTenantContext).toBe("function");
  });
});
