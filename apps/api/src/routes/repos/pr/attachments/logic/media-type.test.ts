import { describe, expect, it } from "vitest";
import { readDeclaredMediaType } from "./media-type";

describe("readDeclaredMediaType", () => {
  it("reads an allowlisted image type", () => {
    expect(readDeclaredMediaType("image/png")).toBe("image/png");
  });

  it("drops parameters and case", () => {
    expect(readDeclaredMediaType("Image/JPEG; charset=binary")).toBe(
      "image/jpeg",
    );
  });

  it("refuses a missing header and any other type", () => {
    expect(readDeclaredMediaType(undefined)).toBeUndefined();
    expect(readDeclaredMediaType("image/svg+xml")).toBeUndefined();
    expect(readDeclaredMediaType("text/plain")).toBeUndefined();
  });
});
