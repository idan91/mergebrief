import { describe, expect, it, vi } from "vitest";

import { isDemoBuild } from "./demo-build";

describe("isDemoBuild", () => {
  it("is off unless ENABLE_DEMO is switched on", () => {
    vi.stubEnv("ENABLE_DEMO", "");
    expect(isDemoBuild()).toBe(false);
    vi.stubEnv("ENABLE_DEMO", "true");
    expect(isDemoBuild()).toBe(true);
    vi.stubEnv("ENABLE_DEMO", "1");
    expect(isDemoBuild()).toBe(true);
  });
});
