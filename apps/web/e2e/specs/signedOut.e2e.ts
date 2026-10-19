// Signed-out Home, under the project that carries no session: the pitch, one
// picture of a brief, Sign in with GitHub, and no URL box.
import { expect, test } from "@playwright/test";

import { expectNoSeriousAxeViolations } from "../support/axe";
import { collectPageFaults } from "../support/console";

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
