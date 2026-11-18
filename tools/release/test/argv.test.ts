import { describe, expect, it } from "vitest";
import { parseArgv } from "../src/logic/argv";

const SPEC = {
  valued: ["--tag", "--known-tags"],
  boolean: ["--json"],
  maxPositionals: 1,
};

function parseErrors(argv: readonly string[]): string {
  const parsed = parseArgv(argv, SPEC);
  return parsed.ok ? "" : parsed.error;
}

describe("the argv parser", () => {
  it("separates positionals, valued flags and boolean flags", () => {
    const parsed = parseArgv(
      ["v0.1.0", "--tag", "v0.1.0", "--known-tags", "", "--json"],
      SPEC,
    );

    expect(parsed.ok && parsed.value.positionals).toEqual(["v0.1.0"]);
    expect(parsed.ok && parsed.value.flags.get("--tag")).toBe("v0.1.0");
    expect(parsed.ok && parsed.value.flags.get("--known-tags")).toBe("");
    expect(parsed.ok && parsed.value.flags.get("--json")).toBe(true);
  });

  it("refuses an unknown flag so a typo never passes as no flag", () => {
    expect(parseErrors(["--tags", "v0.1.0"])).toBe("unknown flag --tags");
    expect(parseErrors(["--tag=v0.1.0"])).toBe(
      "unknown flag --tag=v0.1.0; pass the value as the next argument",
    );
  });

  it("refuses a valued flag without a value", () => {
    expect(parseErrors(["--tag"])).toBe("--tag needs a value");
    expect(parseErrors(["--tag", "--json"])).toBe("--tag needs a value");
  });

  it("refuses a repeated flag and too many positionals", () => {
    expect(parseErrors(["--json", "--json"])).toBe("--json given twice");
    expect(parseErrors(["a", "b"])).toBe("unexpected argument b");
  });
});
