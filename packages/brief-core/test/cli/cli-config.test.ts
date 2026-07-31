import { describe, expect, it } from "vitest";
import { extractConfigFlag } from "../../src/cli/config";

describe("extractConfigFlag", () => {
  it("passes argv through untouched when the flag is absent", () => {
    expect(extractConfigFlag(["url-a", "url-b"])).toEqual({
      configPath: null,
      rest: ["url-a", "url-b"],
    });
  });

  it("extracts the path and removes the pair from argv", () => {
    expect(
      extractConfigFlag(["--config", "conf.yaml", "url", "base", "head"]),
    ).toEqual({
      configPath: "conf.yaml",
      rest: ["url", "base", "head"],
    });
    expect(extractConfigFlag(["url", "--config", "conf.yaml"])).toEqual({
      configPath: "conf.yaml",
      rest: ["url"],
    });
  });

  it.each([
    [["--config"]],
    [["--config", "--json"]],
    [["--config", "-x"]],
  ])("treats a missing or flag-shaped value as a usage error: %j", (args) => {
    expect(extractConfigFlag(args)).toBeNull();
  });
});
