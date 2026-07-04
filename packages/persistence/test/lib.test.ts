import { describe, expect, it } from "vitest";
import { PERSISTENCE_PACKAGE_NAME } from "../src/lib.js";

describe("persistence package", () => {
  it("imports and exposes its placeholder export", () => {
    expect(PERSISTENCE_PACKAGE_NAME).toBe("persistence");
  });
});
