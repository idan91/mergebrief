// The Sort menu on the Inbox: Created joins the sorts, the direction turns
// the list oldest first, and both ride the address.
import { expect, test } from "@playwright/test";

import { INBOX_ROWS } from "../fixtures/inbox";
import { collectPageFaults } from "../support/console";
import { waitForFirstLoad, waitForInteractive } from "../support/page";

test("the Inbox sorts by creation time, oldest first on request", async ({
  page,
}) => {
  const faults = collectPageFaults(page);
  const oldest = INBOX_ROWS.toSorted(
    (first, second) => second.createdDaysAgo - first.createdDaysAgo,
  )[0];
  if (oldest === undefined) {
    throw new Error("the fixture holds no rows");
  }

  await page.goto("/");
  await waitForFirstLoad(page);
  await waitForInteractive(page);
  const titles = page.getByTestId("inbox-row-title");
  await expect(titles.first()).not.toHaveText(oldest.title);

  // Created is one of the sorts; the menu stays open for the direction.
  await page.getByRole("button", { name: "Sort Updated" }).click();
  await page.getByRole("option", { name: "Created" }).click();
  await expect(page).toHaveURL(/[?&]sort=created$/);
  await expect(titles.first()).not.toHaveText(oldest.title);

  // Oldest first turns the list and the trigger says so.
  await page.getByRole("option", { name: "Oldest first" }).click();
  await expect(page).toHaveURL(/[?&]sort=created&direction=asc$/);
  await expect(titles.first()).toHaveText(oldest.title);
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "Sort Created, oldest first" }),
  ).toBeVisible();

  // The address alone reproduces the list.
  await page.reload();
  await waitForFirstLoad(page);
  await expect(titles.first()).toHaveText(oldest.title);

  expect(faults).toEqual([]);
});
