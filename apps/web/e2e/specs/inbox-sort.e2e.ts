// The Sort menu on the Inbox: Created joins the sorts, the direction turns
// the list oldest first, and both ride the address.
import { expect, test, type Locator } from "@playwright/test";

import { INBOX_ROWS } from "../fixtures/inbox";
import { collectPageFaults } from "../support/console";
import { waitForFirstLoad } from "../support/page";

/** Updated 20 minutes ago and opened 20 days ago. */
const RETRY_TITLE = "Retry failed webhook deliveries with backoff";
/** Updated 95 minutes ago and opened 18 days ago: after the row above by update, before it by creation. */
const ROUNDING_TITLE_START = "Move invoice rounding";

async function isListedBefore(
  titles: Locator,
  earlier: string,
  later: string,
): Promise<boolean> {
  const shown = await titles.allInnerTexts();
  const earlierAt = shown.findIndex((title) => title.startsWith(earlier));
  const laterAt = shown.findIndex((title) => title.startsWith(later));
  const bothShown = earlierAt !== -1 && laterAt !== -1;
  return bothShown && earlierAt < laterAt;
}

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
  const titles = page.getByTestId("inbox-row-title");
  await expect
    .poll(() => isListedBefore(titles, RETRY_TITLE, ROUNDING_TITLE_START))
    .toBe(true);

  // Created is one of the sorts and reorders the rows; the menu stays open for the direction.
  await page.getByRole("button", { name: "Sort Updated" }).click();
  await page.getByRole("option", { name: "Created" }).click();
  await expect(page).toHaveURL(/[?&]sort=created$/);
  await expect
    .poll(() => isListedBefore(titles, ROUNDING_TITLE_START, RETRY_TITLE))
    .toBe(true);

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
