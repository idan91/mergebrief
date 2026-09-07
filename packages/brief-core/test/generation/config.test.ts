import { describe, expect, it } from "vitest";
import { parseRevisionNarrativeFlag } from "../../src/generation/config";

describe("parseRevisionNarrativeFlag", () => {
  it("is enabled when the value is absent", () => {
    expect(parseRevisionNarrativeFlag(undefined)).toEqual({ enabled: true });
  });

  it("is disabled for the documented off spellings, any case", () => {
    for (const raw of ["false", "0", "off", "no", "FALSE", "Off"]) {
      expect(parseRevisionNarrativeFlag(raw)).toEqual({ enabled: false });
    }
  });

  it("is enabled for any other value", () => {
    expect(parseRevisionNarrativeFlag("true")).toEqual({ enabled: true });
    expect(parseRevisionNarrativeFlag("")).toEqual({ enabled: true });
  });
});
