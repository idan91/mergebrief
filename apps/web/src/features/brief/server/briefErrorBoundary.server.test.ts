// The local-brief error boundary. A server function's rejection is SERIALIZED
// TO THE BROWSER, so the assertions here are about what must NOT be in the
// message: absolute paths, node error codes, and reflected caller input.
import { describe, expect, it } from "vitest";

import { readComparisonMarks, readLocalBrief } from "./brief.server";
import {
  briefErrorDetail,
  BriefErrorMessage,
  isCuratedBriefError,
} from "../utils/briefErrors";

/** Passes the id charset guard; no artifact of that name exists. */
const ABSENT_ID = "no-such-brief_1_deadbeef";

describe("readLocalBrief on a missing artifact", () => {
  it("reports a curated not-found, never the ENOENT path disclosure", async () => {
    // A raw rejection here would be `ENOENT: … open '<abs>/…delta.json'`,
    // handing the deployment's filesystem layout to any visitor.
    await expect(readLocalBrief(ABSENT_ID)).rejects.toThrow(
      BriefErrorMessage.NOT_FOUND,
    );
    const error = await readLocalBrief(ABSENT_ID).catch((caught: unknown) =>
      caught instanceof Error ? caught.message : String(caught),
    );
    expect(error).not.toContain("/");
    expect(error).not.toContain("ENOENT");
    expect(error).not.toContain(ABSENT_ID);
  });
});

describe("brief id validation", () => {
  it("never echoes the rejected id back to the caller", async () => {
    const hostile = "../../etc/passwd";
    const error = await readComparisonMarks(hostile).catch((caught: unknown) =>
      caught instanceof Error ? caught.message : String(caught),
    );
    expect(error).toBe(BriefErrorMessage.INVALID_ID);
    expect(error).not.toContain("passwd");
  });
});

describe("briefErrorDetail", () => {
  it("passes a curated message through", () => {
    expect(briefErrorDetail(new Error(BriefErrorMessage.NOT_FOUND))).toBe(
      BriefErrorMessage.NOT_FOUND,
    );
  });

  it("replaces anything else — the allowlist is the render gate", () => {
    const raw = new Error(
      "ENOENT: no such file or directory, open '/app/tools/categorizer/out/x.json'",
    );
    expect(briefErrorDetail(raw)).toBe(BriefErrorMessage.UNEXPECTED);
    expect(isCuratedBriefError(raw.message)).toBe(false);
  });

  it("handles a non-Error rejection", () => {
    expect(briefErrorDetail("boom")).toBe(BriefErrorMessage.UNEXPECTED);
  });
});
