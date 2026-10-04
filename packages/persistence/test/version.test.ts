// The semver grammar: a parse that accepts a leading v and drops a suffix,
// an ordering, and the canonical text.
import { describe, expect, it } from "vitest";
import { compareSemver, formatSemver, parseSemver } from "../src/version";

describe("parseSemver", () => {
  it("reads major.minor.patch with a leading v or build metadata", () => {
    expect(parseSemver("1.4.0")).toEqual({
      ok: true,
      value: { major: 1, minor: 4, patch: 0 },
    });
    expect(parseSemver(" v2.0.1 ")).toEqual({
      ok: true,
      value: { major: 2, minor: 0, patch: 1 },
    });
    expect(parseSemver("3.0.0+build.7")).toEqual({
      ok: true,
      value: { major: 3, minor: 0, patch: 0 },
    });
  });

  it("refuses text that is not a version or has an unbounded number", () => {
    const refused = { ok: false, error: "not major.minor.patch" };
    expect(parseSemver("dev")).toEqual(refused);
    expect(parseSemver("1.4")).toEqual(refused);
    expect(parseSemver("1.4.0 ; rm")).toEqual(refused);
    expect(parseSemver("3.0.0+0; touch /tmp/x")).toEqual(refused);
    expect(parseSemver("99999999999999999999999.0.0")).toEqual(refused);
  });

  it("refuses a prerelease with its own reason, never equal to a release", () => {
    const refused = { ok: false, error: "a prerelease is not a release" };
    expect(parseSemver("1.5.0-rc.1")).toEqual(refused);
    expect(parseSemver("v1.5.0-0")).toEqual(refused);
    expect(parseSemver("3.0.0-0; touch /tmp/x")).toEqual(refused);
  });
});

describe("compareSemver and formatSemver", () => {
  it("orders by major, then minor, then patch", () => {
    const base = { major: 1, minor: 4, patch: 0 };
    expect(
      compareSemver({ major: 2, minor: 0, patch: 0 }, base),
    ).toBeGreaterThan(0);
    expect(compareSemver({ major: 1, minor: 3, patch: 9 }, base)).toBeLessThan(
      0,
    );
    expect(
      compareSemver({ major: 1, minor: 4, patch: 1 }, base),
    ).toBeGreaterThan(0);
    expect(compareSemver(base, base)).toBe(0);
  });

  it("prints the canonical text", () => {
    expect(formatSemver({ major: 1, minor: 4, patch: 0 })).toBe("1.4.0");
  });
});
