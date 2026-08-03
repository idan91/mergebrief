// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ApiError, ApiErrorKind } from "../../../../../data/apiFetch";
import { PrBriefError } from "./PrBriefError";
import { PR_BRIEF_GENERIC_DETAIL, prBriefErrorDetail } from "./utils";

afterEach(cleanup);

describe("prBriefErrorDetail", () => {
  it("answers every ApiError kind with curated copy", () => {
    for (const kind of Object.values(ApiErrorKind)) {
      const detail = prBriefErrorDetail(new ApiError(kind, 500, "/api/x"));
      expect(detail.length).toBeGreaterThan(0);
      // Never the ApiError message — it embeds the request path.
      expect(detail).not.toContain("/api/x");
    }
  });

  it("degrades a non-ApiError to the generic sentence", () => {
    const raw = new Error(
      "ENOENT: no such file or directory, open '/app/secret/path.json'",
    );
    expect(prBriefErrorDetail(raw)).toBe(PR_BRIEF_GENERIC_DETAIL);
  });
});

describe("PrBriefError", () => {
  it("never renders a raw error message into the page", () => {
    render(
      <PrBriefError
        error={new Error("connect ECONNREFUSED 10.0.0.7:5432 as pg_admin")}
      />,
    );
    const rendered = screen.getByTestId("pr-brief-error").textContent ?? "";
    expect(rendered).toContain(PR_BRIEF_GENERIC_DETAIL);
    expect(rendered).not.toContain("ECONNREFUSED");
    expect(rendered).not.toContain("10.0.0.7");
  });

  it("offers the sign-in CTA only on an unauthorized ApiError", () => {
    render(
      <PrBriefError
        error={new ApiError(ApiErrorKind.UNAUTHORIZED, 401, "/api/pulls")}
      />,
    );
    expect(screen.getByRole("link", { name: /sign in/i })).toBeDefined();

    cleanup();
    render(
      <PrBriefError
        error={new ApiError(ApiErrorKind.NOT_FOUND, 404, "/api/pulls")}
      />,
    );
    expect(screen.queryByRole("link", { name: /sign in/i })).toBeNull();
  });
});
