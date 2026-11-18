import { describe, expect, it } from "vitest";

import { presentRef } from "./utils";

describe("presentRef", () => {
  it("returns undefined when the ref is empty", () => {
    expect(presentRef("")).toBe(undefined);
  });
});
