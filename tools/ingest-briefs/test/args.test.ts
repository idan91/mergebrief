// The CLI's argument grammar. pnpm forwards `--` into argv, so the two
// invocation shapes in the header comment must parse identically.
import { describe, expect, it } from "vitest";
import { parseArgs } from "../src/args";

describe("parseArgs", () => {
  it("reads a target and the resolve flag", () => {
    const args = parseArgs(["--target", "installation:12", "--resolve-repos"]);
    expect(args.target).toBe("installation:12");
    expect(args.resolveRepos).toBe(true);
  });

  it("ignores the pnpm-forwarded `--` separator", () => {
    expect(parseArgs(["--", "--target", "user:7"]).target).toBe("user:7");
  });

  it("rejects a bare value", () => {
    expect(() => parseArgs(["installation:12"])).toThrow("unexpected argument");
  });
});
