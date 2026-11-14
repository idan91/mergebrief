// The fixture brief renders end to end through the real server: story
// sections, chunk cards and diff rows, with a clean console.
import { expect, test } from "@playwright/test";

import {
  FIXTURE_GROUP_TITLES,
  FIXTURE_PR_TITLE,
  FIXTURE_ROUTE_REV2,
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

test("opens the Product diff and shows a change as before and after", async ({
  page,
}) => {
  await page.goto(FIXTURE_ROUTE_REV2);
  await waitForInteractive(page);

  const toggle = page.getByRole("button", { name: /Product diff/ });
  await expect(toggle).toContainText("5 product changes");
  await toggle.click();

  const bar = page.getByTestId("product-diff-bar");
  await expect(
    bar.getByRole("heading", { name: "When a link to the app is shared" }),
  ).toBeVisible();
  await expect(bar.getByText("Not shown in this diff")).toBeVisible();
  await expect(bar.getByText("Did not exist before this PR")).toBeVisible();
  await expect(bar.getByText("per the PR description")).toBeVisible();
});
