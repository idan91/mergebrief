// A selection bar rises once rows are ticked: Archive takes every ticked
// row, Delete counts only the rows the viewer may delete and confirms once,
// and Clear hands focus to the list heading. The rows it touches are its own.
import { expect, test } from "@playwright/test";

import {
  INBOX_BULK_ARCHIVE_ROW_NUMBERS,
  INBOX_BULK_DELETE_ROW_NUMBER,
  INBOX_ROWS,
} from "../fixtures/inbox";
import { collectPageFaults } from "../support/console";

const [, , , nonAdminRow] = INBOX_ROWS;
const deleteRow = INBOX_ROWS.find(
  (row) => row.prNumber === INBOX_BULK_DELETE_ROW_NUMBER,
);
const archiveRows = INBOX_ROWS.filter((row) =>
  INBOX_BULK_ARCHIVE_ROW_NUMBERS.some((number) => number === row.prNumber),
);

test("ticked rows archive together, and Delete counts the deletable ones", async ({
  page,
}) => {
  const faults = collectPageFaults(page);
  const [firstArchive, secondArchive] = archiveRows;
  if (
    deleteRow === undefined ||
    nonAdminRow === undefined ||
    firstArchive === undefined ||
    secondArchive === undefined
  ) {
    throw new Error("the inbox fixture lost its rows");
  }

  await page.goto("/");
  const rows = page.getByTestId("inbox-row");
  const bar = page.getByTestId("selection-bar");
  await expect(page.locator('[data-first-load="false"]')).toBeAttached();

  // The input is visually replaced by a drawn box: a click lands on its label.
  await rows.filter({ hasText: firstArchive.title }).locator("label").click();
  await rows.filter({ hasText: secondArchive.title }).locator("label").click();
  await expect(bar.getByText("2 selected")).toBeVisible();
  await page.getByRole("button", { name: "Clear selection" }).click();
  await expect(bar.getByText("2 selected")).toBeHidden();
  await expect(
    page.getByRole("heading", { level: 2, name: "Briefs" }),
  ).toBeFocused();

  await rows.filter({ hasText: firstArchive.title }).locator("label").click();
  await rows.filter({ hasText: secondArchive.title }).locator("label").click();
  await page.getByRole("button", { name: "Archive 2" }).click();

  await expect(rows.filter({ hasText: firstArchive.title })).toHaveCount(0);
  await expect(rows.filter({ hasText: secondArchive.title })).toHaveCount(0);
  await expect(bar.getByText("2 selected")).toBeHidden();

  await rows.filter({ hasText: deleteRow.title }).locator("label").click();
  await rows.filter({ hasText: nonAdminRow.title }).locator("label").click();
  await expect(page.getByText("1 cannot be deleted")).toBeVisible();
  await page.getByRole("button", { name: "Delete 1" }).click();

  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("heading", {
      level: 2,
      name: `Delete briefs for #${String(deleteRow.prNumber)} acme/payments?`,
    }),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "Delete" }).click();

  await expect(rows.filter({ hasText: deleteRow.title })).toHaveCount(0);
  await expect(rows.filter({ hasText: nonAdminRow.title })).toHaveCount(1);
  await expect(bar.getByText("1 selected")).toBeVisible();

  expect(faults).toEqual([]);
});
