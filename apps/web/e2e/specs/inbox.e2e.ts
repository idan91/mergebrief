// Signed in with rows: the Inbox lists both installations and the viewer's
// URL row from one page, folds the rows that need the reviewer above the
// rest, marks each row's review state, and prints a status only when it is
// not Open. The URL row is read live before the list answers.
import { expect, test } from "@playwright/test";

import { INBOX_ROWS, INBOX_URL_ROW_TITLE } from "../fixtures/inbox";
import { collectPageFaults } from "../support/console";

const [fresh, changed, inProgress, reviewed, yours] = INBOX_ROWS;

test("the Inbox folds, marks and prints status only when not Open", async ({
  page,
}) => {
  const faults = collectPageFaults(page);

  const response = await page.goto("/");
  expect(response?.status()).toBe(200);

  // The personal line leads with the one changed row, then the two new ones.
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "1 pull request changed since you reviewed it",
    }),
  ).toBeVisible();
  await expect(page.getByText("2 more are new to you.")).toBeVisible();

  // Rows above the fold in the server's order (most recently updated first),
  // then the quiet line, then the reviewed row and the viewer's own.
  const rows = page.getByTestId("inbox-row");
  await expect(rows).toHaveCount(INBOX_ROWS.length + 1);
  const titles = await rows.locator("a").allInnerTexts();
  const order = titles.map((text) => text.split("\n")[0]);
  // The URL row was read live a moment ago, so it is the most recently updated.
  expect(order.slice(0, 4)).toEqual([
    INBOX_URL_ROW_TITLE,
    fresh?.title,
    changed?.title.replaceAll("`", ""),
    inProgress?.title,
  ]);
  expect(order.slice(4)).toEqual([reviewed?.title, yours?.title]);
  await expect(page.getByText("Nothing new below")).toBeVisible();

  // The marks name their state for assistive technology.
  await expect(rows.nth(0).getByText("New", { exact: true })).toBeAttached();
  await expect(rows.nth(1).getByText("New", { exact: true })).toBeAttached();
  await expect(
    rows.nth(2).getByText("Updated since your review"),
  ).toBeAttached();
  await expect(rows.nth(3).getByText("In progress")).toBeAttached();
  await expect(rows.nth(4).getByText("Reviewed")).toBeAttached();
  await expect(rows.nth(5).getByText("Yours")).toBeAttached();

  // Status only when it is not Open: the draft row prints Draft, no row
  // prints Open. The URL row carries its source and its live-read head kept
  // it current, so no unreachable chip.
  await expect(rows.nth(4).getByText("Draft")).toBeVisible();
  await expect(page.getByText("Open", { exact: true })).toHaveCount(0);
  await expect(rows.nth(0).getByText("Added from a URL")).toBeAttached();
  await expect(page.getByText("Unreachable")).toHaveCount(0);

  // Inline code in a title renders as code.
  await expect(rows.nth(2).locator("code")).toHaveText("ledger");

  expect(faults).toEqual([]);
});
