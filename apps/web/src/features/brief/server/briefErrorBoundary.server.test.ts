// The local-brief error boundary. A server function's rejection is SERIALIZED
// TO THE BROWSER, so the assertions here are about what must NOT be in the
// message: absolute paths, node error codes, and reflected caller input.
import { describe, expect, it } from "vitest";

import { appI18n } from "../../../i18n/I18nProvider";

import { readComparisonMarks, readLocalBrief } from "./brief.server";
import {
  briefErrorCode,
  briefErrorDetail,
  BriefErrorCode,
  GenerateErrorCode,
  isCuratedBriefError,
} from "../utils/briefErrors";

/** Passes the id charset guard; no artifact of that name exists. */
const ABSENT_ID = "no-such-brief_1_deadbeef";

describe("readLocalBrief on a missing artifact", () => {
  it("reports a curated not-found, never the ENOENT path disclosure", async () => {
    // A raw rejection here would be `ENOENT: … open '<abs>/…delta.json'`,
    // handing the deployment's filesystem layout to any visitor.
    await expect(readLocalBrief(ABSENT_ID)).rejects.toThrow(
      BriefErrorCode.NOT_FOUND,
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
    expect(error).toBe(BriefErrorCode.INVALID_ID);
    expect(error).not.toContain("passwd");
  });
});

describe("briefErrorCode / briefErrorDetail", () => {
  it("passes a curated code through and renders its catalog copy", () => {
    const error = new Error(BriefErrorCode.NOT_FOUND);
    expect(briefErrorCode(error)).toBe(BriefErrorCode.NOT_FOUND);
    expect(briefErrorDetail(appI18n.t, error)).toBe(
      appI18n.t("briefError.not-found"),
    );
  });

  it("replaces anything else — the allowlist is the render gate", () => {
    const raw = new Error(
      "ENOENT: no such file or directory, open '/app/tools/categorizer/out/x.json'",
    );
    expect(briefErrorCode(raw)).toBe(BriefErrorCode.UNEXPECTED);
    // The rendered sentence must never carry the raw path.
    expect(briefErrorDetail(appI18n.t, raw)).toBe(
      appI18n.t("briefError.unexpected"),
    );
    expect(briefErrorDetail(appI18n.t, raw)).not.toContain("/app/");
    expect(isCuratedBriefError(raw.message)).toBe(false);
  });

  it("renders a GENERATE code as copy — the URL box must never show a token", () => {
    for (const code of Object.values(GenerateErrorCode)) {
      const rendered = briefErrorDetail(appI18n.t, new Error(code));
      expect(rendered).not.toBe(code);
      expect(rendered.length).toBeGreaterThan(code.length);
    }
  });

  it("handles a non-Error rejection", () => {
    expect(briefErrorCode("boom")).toBe(BriefErrorCode.UNEXPECTED);
  });
});
