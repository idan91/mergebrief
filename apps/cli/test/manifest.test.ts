import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const manifest: {
  version: string;
  private?: boolean;
  files: string[];
  bin: Record<string, string>;
  dependencies?: Record<string, string>;
  license: string;
} = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);

describe("the published manifest", () => {
  it("lists exactly the bundled runtime deps, which the stamp strips", () => {
    expect(Object.keys(manifest.dependencies ?? {})).toEqual([
      "commander",
      "i18n",
      "zod",
    ]);
  });

  it("ships dist only, under the fair source license", () => {
    expect(manifest.files).toEqual(["dist"]);
    expect(manifest.license).toBe("FSL-1.1-ALv2");
  });

  it("names the bin without a ./ prefix, which npm 11 strips on publish", () => {
    expect(manifest.bin).toEqual({ mergebrief: "dist/mergebrief.js" });
  });

  it("keeps the dev sentinel and stays private until the stamp", () => {
    expect(manifest.version).toBe("0.0.0");
    expect(manifest.private).toBe(true);
  });
});
