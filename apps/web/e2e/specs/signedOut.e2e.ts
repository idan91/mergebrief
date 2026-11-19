// Signed-out Home, in contexts that carry no session: one heading, Sign in
// with GitHub, and no URL box.
import { expect, test } from "@playwright/test";

import { FIXTURE_PR_PATH } from "../fixtures/ids";
import { expectNoSeriousAxeViolations } from "../support/axe";
import { collectPageFaults } from "../support/console";

/** A sign-in wall, never a server error: crawlers and monitors read the status. */
const SIGNED_OUT_STATUS = 401;

test.use({ storageState: { cookies: [], origins: [] } });

test("signed out shows one heading and Sign in, never the URL box", async ({
  page,
}, testInfo) => {
  const faults = collectPageFaults(page);

  const response = await page.goto("/");
  expect(response?.status()).toBe(200);

  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "Sign in",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("main").getByRole("link", { name: "Sign in with GitHub" }),
  ).toHaveAttribute("href", "/api/auth/github");
  await expect(page.getByRole("banner")).toHaveCount(0);
  await expect(page).toHaveTitle("Sign in · MergeBrief");
  await expect(page.getByLabel("Pull request URL")).toHaveCount(0);
  await expect(page.getByTestId("inbox-row")).toHaveCount(0);

  await expectNoSeriousAxeViolations(page, testInfo, "home-signed-out");
  expect(faults).toEqual([]);
});

test("a failed sign-in says so above Sign in", async ({ page }) => {
  await page.goto("/?error=sign-in-failed");

  await expect(page.getByRole("main").getByRole("alert")).toHaveText(
    "Signing in didn't complete. Try again.",
  );
});

test("the server-function transport answers 404", async ({ request }) => {
  const transport = await request.get("/_serverFn/abc");
  const encoded = await request.get("/%5FserverFn/abc");

  expect(transport.status()).toBe(404);
  expect(encoded.status()).toBe(404);
});

test("a signed-out deep link signs in and returns to the brief", async ({
  page,
  request,
}, testInfo) => {
  const response = await page.goto(`${FIXTURE_PR_PATH}?rev=1`);
  expect(response?.status()).toBe(SIGNED_OUT_STATUS);

  const main = page.getByRole("main");
  await expect(
    main.getByRole("heading", {
      level: 1,
      name: "Sign in to read this brief",
    }),
  ).toBeVisible();
  const signIn = main.getByRole("link", { name: "Sign in with GitHub" });
  await expect(signIn).toHaveAttribute(
    "href",
    "/api/auth/github?returnTo=%2Frepos%2F424242%2Fpulls%2F1%3Frev%3D1",
  );
  // The client re-reads the brief after hydration and remounts this page.
  await page.waitForLoadState("networkidle");
  await expectNoSeriousAxeViolations(page, testInfo, "pr-signed-out");

  const href = await signIn.getAttribute("href");
  const start = await request.get(href ?? "", { maxRedirects: 0 });
  expect(start.status()).toBe(302);
  expect(start.headers()["set-cookie"]).toContain(
    "__Host-mergebrief_oauth_return=",
  );
});
