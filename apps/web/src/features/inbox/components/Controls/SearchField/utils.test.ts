import { describe, expect, it } from "vitest";

import { dropLandedWrites, isOutsideChange, rememberOwnWrite } from "./utils";

describe("isOutsideChange", () => {
  it("is false when the URL lands on what the field holds, trimmed", () => {
    expect(isOutsideChange("anchor", " anchor ", [])).toBe(false);
  });

  it("is false when the URL lands on a write the field made", () => {
    expect(isOutsideChange("anc", "anchor", ["anc"])).toBe(false);
  });

  it("is true when the URL holds text the field never wrote", () => {
    expect(isOutsideChange("", "anchor", ["anc", "anchor"])).toBe(true);
  });
});

describe("rememberOwnWrite", () => {
  it("keeps the newest four writes", () => {
    const writes = ["a", "ab", "abc", "abcd"];

    expect(rememberOwnWrite(writes, "abcde")).toEqual([
      "ab",
      "abc",
      "abcd",
      "abcde",
    ]);
  });
});

describe("dropLandedWrites", () => {
  it("drops the write that landed and every write before it", () => {
    expect(dropLandedWrites(["", "anc", "anchor"], "anc")).toEqual(["anchor"]);
  });

  it("keeps every write when the URL holds none of them", () => {
    expect(dropLandedWrites(["anc"], "other")).toEqual(["anc"]);
  });
});
