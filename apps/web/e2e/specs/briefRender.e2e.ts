// The fixture brief renders end to end through the real server: story
// sections, chunk cards and diff rows, with a clean console.
import { expect, test } from "@playwright/test";

import {
  FIXTURE_GROUP_TITLES,
  FIXTURE_PR_TITLE,
  FIXTURE_ROUTE_REV2,
  MISSING_PR_PATH,
} from "../fixtures/ids";
import { collectPageFaults } from "../support/console";
import { waitForInteractive } from "../support/page";

test("renders the fixture brief with no browser faults", async ({ page }) => {
  const faults = collectPageFaults(page);

  const response = await page.goto(FIXTURE_ROUTE_REV2);
  expect(response?.status()).toBe(200);

  // The receipt drawer carries its own `<h1>`, so name the one under test.
  await expect(
    page.getByRole("heading", { level: 1, name: FIXTURE_PR_TITLE }),
  ).toBeVisible();
  await expect(page.getByTestId("brief-summary")).toContainText(
    "A fixture brief for the browser suite",
  );

  // Story sections: one heading per change group, in the brief's order.
  for (const title of FIXTURE_GROUP_TITLES) {
    await expect(page.getByRole("heading", { name: title })).toBeVisible();
  }

  // Four attributed chunks plus the two unattributed ones, which render as
  // the remainder group's cards.
  const chunks = page.getByTestId("brief-chunk");
  await expect(chunks).toHaveCount(6);
  await expect(chunks.first()).toContainText(
    "apps/web/src/features/brief/components/Header/Header.tsx",
  );

  // Diffs come from the live span-diff proxy (the harness's GitHub stub
  // serves the fixture patches); if the fetch broke the cards would still
  // render, so assert the rows.
  await expect(page.locator("[data-line-kind='add']").first()).toBeVisible();
  expect(await page.locator("[data-line-kind]").count()).toBeGreaterThan(50);

  await waitForInteractive(page);
  expect(faults).toEqual([]);
});

test("a pull request with no row renders the not-found state", async ({
  page,
}) => {
  // The route contract: an unknown PR is a 404 through the router's
  // not-found handling, not a redirect and not a blank page.
  const response = await page.goto(MISSING_PR_PATH);
  expect(response?.status()).toBe(404);
  await expect(page.locator("body")).toContainText(/not found/i);
});
