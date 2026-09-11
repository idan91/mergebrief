import { describe, expect, it } from "vitest";

import { presentRef } from "./utils";

describe("presentRef", () => {
  it("returns undefined when the ref is absent", () => {
    expect(presentRef(undefined)).toBe(undefined);
  });

  it("returns undefined when the ref is empty", () => {
    expect(presentRef("")).toBe(undefined);
  });

  it("returns the ref when it has a name", () => {
    expect(presentRef("feature/thing")).toBe("feature/thing");
  });
});
