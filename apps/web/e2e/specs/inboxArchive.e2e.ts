// Archive puts a row out of the viewer's Inbox: it leaves the list and the
// personal line, Show: Archived lists it on its own, and Unarchive brings
// it back.
import { expect, test } from "@playwright/test";

import { INBOX_ROWS } from "../fixtures/inbox";
import { collectPageFaults } from "../support/console";

const [, , inProgressRow] = INBOX_ROWS;

test("Archive hides a row until Unarchive, behind the Show filter", async ({
  page,
}) => {
  const faults = collectPageFaults(page);
  if (inProgressRow === undefined) {
    throw new Error("the inbox fixture lost its rows");
  }

  await page.goto("/");
  const rows = page.getByTestId("inbox-row");
  const target = rows.filter({ hasText: inProgressRow.title });
  await expect(target).toHaveCount(1);
  await expect(page.locator('[data-first-load="false"]')).toBeAttached();

  await target.hover();
  const more = target.getByRole("button", { name: "More actions" });
  await more.click();
  await expect(more).toHaveAttribute("aria-expanded", "true");
  await page.getByRole("menuitem", { name: "Archive" }).click();

  await expect(target).toHaveCount(0);
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "4 pull requests need your attention",
    }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Show", exact: true }).click();
  await page.getByRole("menuitemradio", { name: "Archived" }).click();
  await expect(page).toHaveURL(/archived=only/);
  await expect(
    page.getByRole("button", { name: "Show Archived" }),
  ).toBeVisible();
  await expect(rows).toHaveCount(1);
  await expect(target).toHaveCount(1);

  await target.hover();
  const archivedMore = target.getByRole("button", { name: "More actions" });
  await archivedMore.click();
  await expect(archivedMore).toHaveAttribute("aria-expanded", "true");
  await page.getByRole("menuitem", { name: "Unarchive" }).click();

  await expect(target).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "No archived pull requests" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Back to Inbox" }).click();
  await expect(page).not.toHaveURL(/archived=/);
  await expect(target).toHaveCount(1);

  expect(faults).toEqual([]);
});
