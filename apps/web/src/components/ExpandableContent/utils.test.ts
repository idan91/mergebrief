import { describe, expect, it } from "vitest";

import { exceedsCap, parseCapPx } from "./utils";

describe("parseCapPx", () => {
  it("reads a px cap", () => {
    expect(parseCapPx("280px", 16)).toBe(280);
  });

  it("resolves a rem cap against the root font size", () => {
    expect(parseCapPx("17.5rem", 15)).toBe(262.5);
  });

  it("tolerates surrounding whitespace", () => {
    expect(parseCapPx("  200px  ", 16)).toBe(200);
  });

  it("returns undefined for an unresolved custom property", () => {
    expect(parseCapPx("", 16)).toBeUndefined();
  });

  it("returns undefined for a unit it cannot resolve", () => {
    expect(parseCapPx("50vh", 16)).toBeUndefined();
  });
});

describe("exceedsCap", () => {
  it("is false inside the hysteresis band", () => {
    expect(exceedsCap(208, 200)).toBe(false);
  });

  it("is true one pixel past the hysteresis band", () => {
    expect(exceedsCap(209, 200)).toBe(true);
  });

  it("is false for content shorter than the cap", () => {
    expect(exceedsCap(120, 200)).toBe(false);
  });
});
