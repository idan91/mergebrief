// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ApiError, ApiErrorCodes } from "../../../../../data/apiFetch";
import { appI18n, I18nProvider } from "../../../../../i18n/I18nProvider";
import { renderInRouter } from "../../../../../test/router";
import { PrBriefError } from ".";

afterEach(cleanup);

const t = appI18n.t;
const PR_BRIEF_GENERIC_DETAIL = t("pulls.briefError.generic");

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
          error={new ApiError(ApiErrorCodes.UNAUTHORIZED, 401, "/api/pulls")}
        />
      </I18nProvider>,
    );
    expect(screen.getByRole("link", { name: /sign in/i })).toBeDefined();

    cleanup();
    render(
      <I18nProvider>
        <PrBriefError
          error={new ApiError(ApiErrorCodes.NOT_FOUND, 404, "/api/pulls")}
        />
      </I18nProvider>,
    );
    expect(screen.queryByRole("link", { name: /sign in/i })).toBeNull();
  });

  it("asks a signed-out viewer to sign in and come back here", async () => {
    await renderInRouter(
      <I18nProvider>
        <PrBriefError
          error={new ApiError(ApiErrorCodes.SIGNED_OUT, 401, "/api/pulls")}
          returnTo="/repos/424242/pulls/1?rev=1"
        />
      </I18nProvider>,
    );

    const main = screen.getByRole("main");
    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "Sign in to read this brief",
      }),
    ).toBeTruthy();
    const signIn = screen.getByRole("link", { name: /sign in with github/i });
    expect(main.contains(signIn)).toBe(true);
    expect(signIn.getAttribute("href")).toBe(
      "/api/auth/github?returnTo=%2Frepos%2F424242%2Fpulls%2F1%3Frev%3D1",
    );
    expect(screen.getAllByRole("link", { name: /sign in/i })).toHaveLength(1);
  });

  it("keeps a plain sign-in when the page has no return path", async () => {
    await renderInRouter(
      <I18nProvider>
        <PrBriefError
          error={new ApiError(ApiErrorCodes.SIGNED_OUT, 401, "/api/pulls")}
        />
      </I18nProvider>,
    );

    expect(
      screen
        .getByRole("link", { name: /sign in with github/i })
        .getAttribute("href"),
    ).toBe("/api/auth/github");
  });
});
