// A row the viewer administers on GitHub carries Delete behind a confirm
// that names the row; cancelling hands focus back to the row's menu trigger,
// confirming erases the row and hands focus to the list heading. A row they
// do not administer offers no Delete at all.
import { expect, test } from "@playwright/test";

import { INBOX_DELETE_ROW_NUMBER, INBOX_ROWS } from "../fixtures/inbox";
import { collectPageFaults } from "../support/console";
import { waitForFirstLoad } from "../support/page";

const deleteRow = INBOX_ROWS.find(
  (row) => row.prNumber === INBOX_DELETE_ROW_NUMBER,
);
const [, , , nonAdminRow] = INBOX_ROWS;

test("an admin deletes a row behind a confirm; a non-admin row has no Delete", async ({
  page,
}) => {
  const faults = collectPageFaults(page);
  if (deleteRow === undefined || nonAdminRow === undefined) {
    throw new Error("the inbox fixture lost its rows");
  }

  await page.goto("/");
  const rows = page.getByTestId("inbox-row");
  const target = rows.filter({ hasText: deleteRow.title });
  await expect(target).toHaveCount(1);
  // The actions answer only once the first-load fade has settled.
  await waitForFirstLoad(page);

  await target.hover();
  const more = target.getByRole("button", { name: "More actions" });
  await more.click();
  await expect(more).toHaveAttribute("aria-expanded", "true");
  await page.getByRole("menuitem", { name: "Delete", exact: true }).click();

  const dialog = page.getByRole("dialog");
  const heading = dialog.getByRole("heading", {
    level: 2,
    name: `Delete briefs for #${String(deleteRow.prNumber)} acme/payments?`,
  });
  await expect(heading).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();

  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
  await expect(more).toBeFocused();
  await expect(target).toHaveCount(1);

  await more.click();
  await page.getByRole("menuitem", { name: "Delete", exact: true }).click();
  await expect(heading).toBeVisible();
  await dialog.getByRole("button", { name: "Delete" }).click();

  await expect(target).toHaveCount(0);
  await expect(dialog).toBeHidden();
  await expect(
    page.getByRole("heading", { level: 2, name: "Briefs" }),
  ).toBeFocused();

  const other = rows.filter({ hasText: nonAdminRow.title });
  await other.hover();
  const otherMore = other.getByRole("button", { name: "More actions" });
  await otherMore.click();
  await expect(otherMore).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByRole("menuitem", { name: "Copy link" })).toBeVisible();
  await expect(
    page.getByRole("menuitem", { name: "Delete", exact: true }),
  ).toHaveCount(0);

  expect(faults).toEqual([]);
});
