// Signed-out Home, under the project that carries no session: the pitch, one
// picture of a brief, Sign in with GitHub, and no URL box.
import { expect, test } from "@playwright/test";

import { FIXTURE_PR_PATH } from "../fixtures/ids";
import { expectNoSeriousAxeViolations } from "../support/axe";
import { collectPageFaults } from "../support/console";

/** A sign-in wall, never a server error: crawlers and monitors read the status. */
const SIGNED_OUT_STATUS = 401;

test("signed out shows the pitch, the picture and Sign in, never the URL box", async ({
  page,
}, testInfo) => {
  const faults = collectPageFaults(page);

  const response = await page.goto("/");
  expect(response?.status()).toBe(200);

  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "Understand a pull request before you review it",
    }),
  ).toBeVisible();
  // The bar's Sign in is the Account menu's; the pitch's own is inside main.
  await expect(
    page.getByRole("main").getByRole("link", { name: "Sign in with GitHub" }),
  ).toHaveAttribute("href", "/api/auth/github");
  await expect(
    page.getByRole("img", { name: /A brief open in MergeBrief/ }),
  ).toBeVisible();
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
      name: "Sign in to read this brief.",
    }),
  ).toBeVisible();
  const signIn = main.getByRole("link", { name: "Sign in with GitHub" });
  await expect(signIn).toHaveAttribute(
    "href",
    "/api/auth/github?returnTo=%2Frepos%2F424242%2Fpulls%2F1%3Frev%3D1",
  );
  await expectNoSeriousAxeViolations(page, testInfo, "pr-signed-out");

  const href = await signIn.getAttribute("href");
  const start = await request.get(href ?? "", { maxRedirects: 0 });
  expect(start.status()).toBe(302);
  expect(start.headers()["set-cookie"]).toContain(
    "__Host-mergebrief_oauth_return=",
  );
});
