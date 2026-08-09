// The fixture brief renders end to end through the real server — story
// sections, chunk cards, diff rows — with a clean console.
import { expect, test } from "@playwright/test";

import {
  FIXTURE_BRIEF_REV2,
  FIXTURE_GROUP_TITLES,
  FIXTURE_PR_TITLE,
  MISSING_BRIEF_ID,
} from "../fixtures/ids";
import { collectPageFaults } from "../support/console";
import { waitForInteractive } from "../support/page";

test("renders the fixture brief with no browser faults", async ({ page }) => {
  const faults = collectPageFaults(page);

  const response = await page.goto(`/briefs/${FIXTURE_BRIEF_REV2}`);
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

  // Chunk cards are the spans of the story — each is an <article> keyed by
  // chunk id, carrying its file path.
  const chunks = page.getByTestId("brief-chunk");
  await expect(chunks).toHaveCount(4);
  await expect(chunks.first()).toContainText(
    "apps/web/src/features/brief/components/Header/Header.tsx",
  );

  // Diffs are attached server-side from the `.diffs.json` sidecar; if the
  // sidecar were ignored the cards would still render, so assert the rows.
  await expect(page.locator("[data-line-kind='add']").first()).toBeVisible();
  expect(await page.locator("[data-line-kind]").count()).toBeGreaterThan(50);

  await waitForInteractive(page);
  expect(faults).toEqual([]);
});

test("a brief id with no artifacts renders the route's error state", async ({
  page,
}) => {
  // The route contract: an unreadable brief surfaces through the route's
  // `errorComponent`, not a redirect and not a blank page.
  const response = await page.goto(`/briefs/${MISSING_BRIEF_ID}`);
  expect(response?.status()).toBe(500);
  await expect(
    page.getByRole("heading", { name: "Brief failed to load" }),
  ).toBeVisible();
});
