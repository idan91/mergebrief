import { describe, expect, it } from "vitest";

import { ApiError, ApiErrorCodes } from "../../../../data/apiFetch";
import { appI18n } from "../../../../i18n/I18nProvider";
import { briefErrorDetail, prBriefErrorDetail } from "./briefErrors";

const t = appI18n.t;
const RAW_FAILURE = new Error(
  "ENOENT: no such file or directory, open '/app/secret/path.json'",
);

describe("prBriefErrorDetail", () => {
  it("answers every ApiError kind with curated copy", () => {
    for (const kind of Object.values(ApiErrorCodes)) {
      const detail = prBriefErrorDetail(t, new ApiError(kind, 500, "/api/x"));
      // i18next echoes the KEY for a missing entry: assert real copy, not
      // just non-empty, or a catalog gap would render the key into the page.
      expect(detail).not.toBe(`pulls.briefError.${kind}`);
      expect(detail.length).toBeGreaterThan(0);
      // Never the ApiError message: it embeds the request path.
      expect(detail).not.toContain("/api/x");
    }
  });

  it("degrades a non-ApiError to the generic sentence", () => {
    expect(prBriefErrorDetail(t, RAW_FAILURE)).toBe(
      t("pulls.briefError.generic"),
    );
  });
});

describe("briefErrorDetail", () => {
  it("degrades a non-ApiError to the unexpected sentence", () => {
    expect(briefErrorDetail(t, RAW_FAILURE)).toBe(t("briefError.unexpected"));
  });

  it("names a missing pull request as a failed fetch", () => {
    const missing = new ApiError(ApiErrorCodes.NOT_FOUND, 404, "/api/x");

    expect(briefErrorDetail(t, missing)).toBe(
      t("briefError.signedFetchFailed"),
    );
  });
});
