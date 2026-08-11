// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ApiError, ApiErrorCode } from "../../../../../data/apiFetch";
import { appI18n, I18nProvider } from "../../../../../i18n/I18nProvider";
import { PrBriefError } from "./PrBriefError";
import { prBriefErrorDetail } from "./utils";

const t = appI18n.t;
const PR_BRIEF_GENERIC_DETAIL = t("pulls.briefError.generic");

afterEach(cleanup);

describe("prBriefErrorDetail", () => {
  it("answers every ApiError kind with curated copy", () => {
    for (const kind of Object.values(ApiErrorCode)) {
      const detail = prBriefErrorDetail(t, new ApiError(kind, 500, "/api/x"));
      // i18next echoes the KEY for a missing entry — assert real copy, not
      // just non-empty, or a catalog gap would render the key into the page.
      expect(detail).not.toBe(`pulls.briefError.${kind}`);
      expect(detail.length).toBeGreaterThan(0);
      // Never the ApiError message — it embeds the request path.
      expect(detail).not.toContain("/api/x");
    }
  });

  it("degrades a non-ApiError to the generic sentence", () => {
    const raw = new Error(
      "ENOENT: no such file or directory, open '/app/secret/path.json'",
    );
    expect(prBriefErrorDetail(t, raw)).toBe(PR_BRIEF_GENERIC_DETAIL);
  });
});

describe("PrBriefError", () => {
  it("never renders a raw error message into the page", () => {
    render(
      <I18nProvider>
        <PrBriefError
          error={new Error("connect ECONNREFUSED 10.0.0.7:5432 as pg_admin")}
        />
      </I18nProvider>,
    );
    const rendered = screen.getByTestId("pr-brief-error").textContent ?? "";
    expect(rendered).toContain(PR_BRIEF_GENERIC_DETAIL);
    expect(rendered).not.toContain("ECONNREFUSED");
    expect(rendered).not.toContain("10.0.0.7");
  });

  it("offers the sign-in CTA only on an unauthorized ApiError", () => {
    render(
      <I18nProvider>
        <PrBriefError
          error={new ApiError(ApiErrorCode.UNAUTHORIZED, 401, "/api/pulls")}
        />
      </I18nProvider>,
    );
    expect(screen.getByRole("link", { name: /sign in/i })).toBeDefined();

    cleanup();
    render(
      <I18nProvider>
        <PrBriefError
          error={new ApiError(ApiErrorCode.NOT_FOUND, 404, "/api/pulls")}
        />
      </I18nProvider>,
    );
    expect(screen.queryByRole("link", { name: /sign in/i })).toBeNull();
  });
});
