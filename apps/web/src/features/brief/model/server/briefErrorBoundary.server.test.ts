// The local-brief error boundary. A server function's rejection is SERIALIZED
// TO THE BROWSER, so the assertions here are about what must NOT be in the
// message: absolute paths, node error codes, and reflected caller input.
import { afterEach, describe, expect, it, vi } from "vitest";

import { appI18n } from "../../../../i18n/I18nProvider";

import { getServerLogger } from "../../../../server/logger";
import {
  listLocalBriefs,
  readComparisonMarks,
  readLocalBrief,
} from "./brief.server";
import { requireLocalBriefsDir } from "./outDir.server";
import {
  briefErrorCode,
  briefErrorDetail,
  LocalBriefErrorCodes,
  clampConfigMessage,
  GenerateErrorCodes,
  isCuratedBriefError,
} from "../utils/briefErrors";
import { ApiError, ApiErrorCodes } from "../../../../data/apiFetch";
import { createI18n } from "i18n";

const t = createI18n().t;

/** Passes the id charset guard; no artifact of that name exists. */
const ABSENT_ID = "no-such-brief_1_deadbeef";

describe("readLocalBrief on a missing artifact", () => {
  it("reports a curated not-found, never the ENOENT path disclosure", async () => {
    // A raw rejection here would be `ENOENT: … open '<abs>/…delta.json'`,
    // handing the deployment's filesystem layout to any visitor.
    await expect(readLocalBrief(ABSENT_ID)).rejects.toThrow(
      LocalBriefErrorCodes.NOT_FOUND,
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
    expect(error).toBe(LocalBriefErrorCodes.INVALID_ID);
    expect(error).not.toContain("passwd");
  });
});

describe("briefErrorCode / briefErrorDetail", () => {
  it("passes a curated code through and renders its catalog copy", () => {
    const error = new Error(LocalBriefErrorCodes.NOT_FOUND);
    expect(briefErrorCode(error)).toBe(LocalBriefErrorCodes.NOT_FOUND);
    expect(briefErrorDetail(appI18n.t, error)).toBe(
      appI18n.t("briefError.not-found"),
    );
  });

  it("replaces anything else, the allowlist is the render gate", () => {
    const raw = new Error(
      "ENOENT: no such file or directory, open '/app/tools/categorizer/out/x.json'",
    );
    expect(briefErrorCode(raw)).toBe(LocalBriefErrorCodes.UNEXPECTED);
    // The rendered sentence must never carry the raw path.
    expect(briefErrorDetail(appI18n.t, raw)).toBe(
      appI18n.t("briefError.unexpected"),
    );
    expect(briefErrorDetail(appI18n.t, raw)).not.toContain("/app/");
    expect(isCuratedBriefError(raw.message)).toBe(false);
  });

  it("renders a GENERATE code as copy, the URL box must never show a token", () => {
    for (const code of Object.values(GenerateErrorCodes)) {
      const rendered = briefErrorDetail(appI18n.t, new Error(code));
      expect(rendered).not.toBe(code);
      expect(rendered.length).toBeGreaterThan(code.length);
    }
  });

  it("handles a non-Error rejection", () => {
    expect(briefErrorCode("boom")).toBe(LocalBriefErrorCodes.UNEXPECTED);
  });

  it.each([
    [ApiErrorCodes.NOT_A_PR_URL, "pull request URL"],
    [ApiErrorCodes.UNAUTHORIZED, "sign in again"],
    [ApiErrorCodes.NOT_FOUND, "private repo"],
    [ApiErrorCodes.GENERATION_UNAVAILABLE, "try again"],
  ])("renders signed generation code %s as actionable copy", (code, copy) => {
    expect(
      briefErrorDetail(appI18n.t, new ApiError(code, 503, "/x")),
    ).toContain(copy);
  });

  it("renders a validated generation-config detail", () => {
    expect(
      briefErrorDetail(
        appI18n.t,
        new ApiError(ApiErrorCodes.GENERATION_CONFIG, 503, "/api/generate", {
          detail: "ANTHROPIC_API_KEY is required",
        }),
      ),
    ).toBe("ANTHROPIC_API_KEY is required");
  });

  it("redacts token-shaped config detail before it reaches the browser", () => {
    const leaked = "bad sk-ant-api03-abcdefghijkl";
    expect(clampConfigMessage(t, leaked)).toBe("bad [redacted-token]");
  });
});

describe("the file surface off", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("refuses the file surface with a curated code", () => {
    vi.stubEnv("PROD", true);
    expect(() => requireLocalBriefsDir()).toThrow(
      LocalBriefErrorCodes.DISABLED,
    );
  });

  it("is refused too where no directory is named", () => {
    vi.stubEnv("MERGEBRIEF_OUT_DIR", "");
    expect(() => requireLocalBriefsDir()).toThrow(
      LocalBriefErrorCodes.DISABLED,
    );
  });

  it("lists nothing where no directory is named, without a warning", async () => {
    vi.stubEnv("MERGEBRIEF_OUT_DIR", "");
    const warn = vi.spyOn(getServerLogger(), "warn");

    await expect(listLocalBriefs()).resolves.toEqual([]);
    expect(warn).not.toHaveBeenCalled();
  });

  it("passes that refusal through the render gate unchanged", () => {
    vi.stubEnv("PROD", true);
    const error = (() => {
      try {
        requireLocalBriefsDir();
        return undefined;
      } catch (caught) {
        return caught;
      }
    })();
    expect(briefErrorCode(error)).toBe(LocalBriefErrorCodes.DISABLED);
  });
});
