import { describe, expect, it } from "vitest";

import { SYNTAX_PALETTE, TEXT_CLASS_ID, resolveClassId } from "./palette";

describe("SYNTAX_PALETTE", () => {
  it("holds no duplicate token name", () => {
    const tokens = SYNTAX_PALETTE.map((entry) => entry.token);

    expect(new Set(tokens).size).toBe(tokens.length);
  });

  it("spells every hex lowercase and six digits", () => {
    for (const entry of SYNTAX_PALETTE) {
      expect(entry.hex).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it("puts the plain text role at the fallback class id", () => {
    expect(SYNTAX_PALETTE[TEXT_CLASS_ID]?.token).toBe("text");
  });
});

describe("resolveClassId", () => {
  it("maps a palette hex to its index", () => {
    SYNTAX_PALETTE.forEach((entry, index) => {
      expect(resolveClassId(entry.hex)).toBe(index);
    });
  });

  it("maps an uppercase hex to the same index", () => {
    expect(resolveClassId("#E1E4E8")).toBe(resolveClassId("#e1e4e8"));
  });

  it("falls back to text for a colour outside the palette", () => {
    expect(resolveClassId("#123456")).toBe(TEXT_CLASS_ID);
  });

  it("falls back to text for a missing colour", () => {
    expect(resolveClassId(undefined)).toBe(TEXT_CLASS_ID);
  });
});
