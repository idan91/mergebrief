import { describe, expect, it } from "vitest";

import { runLicenses } from "../../src/logic/licenses";
import { ExitCodes } from "../../src/types";

interface CapturedRun {
  readonly exitCode: number;
  readonly out: string;
  readonly error: string;
}

function runWithListing(listing: string, argv: string[] = []): CapturedRun {
  let out = "";
  let error = "";
  const exitCode = runLicenses(argv, {
    port: { listProductionLicenses: () => listing },
    writeOut: (text) => {
      out += text;
    },
    writeError: (text) => {
      error += text;
    },
  });
  return { exitCode, out, error };
}

function makeListing(groups: Record<string, string[]>): string {
  const listing = Object.fromEntries(
    Object.entries(groups).map(([license, names]) => [
      license,
      names.map((name) => ({ name, versions: ["1.0.0"], paths: [], license })),
    ]),
  );
  return JSON.stringify(listing);
}

describe("the licenses command", () => {
  it("exits 0 and counts packages when every license is allowed", () => {
    const run = runWithListing(makeListing({ MIT: ["commander", "zod"] }));

    expect(run.exitCode).toBe(ExitCodes.OK);
    expect(run.out).toContain("2 packages");
    expect(run.error).toBe("");
  });

  it("refuses with each failing package, version and license", () => {
    const run = runWithListing(
      makeListing({ MIT: ["zod"], "GPL-3.0": ["copyleft-lib"] }),
    );

    expect(run.exitCode).toBe(ExitCodes.REFUSED);
    expect(run.error).toContain("copyleft-lib@1.0.0 GPL-3.0");
    expect(run.error).not.toContain("zod");
  });

  it("prints the reason of each named exception it applied", () => {
    const run = runWithListing(
      makeListing({ "OFL-1.1": ["@fontsource/ibm-plex-mono"] }),
    );

    expect(run.exitCode).toBe(ExitCodes.OK);
    expect(run.out).toContain("@fontsource/ibm-plex-mono@1.0.0 OFL-1.1");
    expect(run.out).toMatch(/redistributed/);
  });

  it("refuses a listing that is not the pnpm licenses shape", () => {
    expect(runWithListing("not json").exitCode).toBe(ExitCodes.REFUSED);
    expect(runWithListing('{"MIT":[{"name":1}]}').exitCode).toBe(
      ExitCodes.REFUSED,
    );
  });

  it("refuses any argument as a usage error", () => {
    const run = runWithListing(makeListing({ MIT: ["zod"] }), ["--dev"]);

    expect(run.exitCode).toBe(ExitCodes.USAGE);
    expect(run.error).toContain("unknown flag --dev");
  });
});
