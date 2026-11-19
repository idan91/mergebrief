// Search text on the Inbox: the slash key reaches the field, typing narrows
// the list and writes the address, a miss the filters cause offers every
// match, and a miss nothing explains offers the way out.
import { expect, test } from "@playwright/test";

import { INBOX_ROWS } from "../fixtures/inbox";
import { collectPageFaults } from "../support/console";
import {
  clickUntilLanded,
  waitForFirstLoad,
  waitForInteractive,
} from "../support/page";

const PAYOUT_TITLE = "Let operators pause a payout batch";

test("search text narrows the Inbox and explains a miss", async ({ page }) => {
  const faults = collectPageFaults(page);
  expect(INBOX_ROWS.map((row) => row.title)).toContain(PAYOUT_TITLE);

  await page.goto("/");
  await waitForFirstLoad(page);
  await waitForInteractive(page);
  const field = page.getByRole("searchbox", {
    name: "Search briefs by title or number",
  });
  const titles = page.getByTestId("inbox-row-title");

  // The slash key focuses the field; typing narrows without losing focus.
  await page.keyboard.press("/");
  await expect(field).toBeFocused();
  await page.keyboard.type("PAYOUT");
  await expect(titles).toHaveText([PAYOUT_TITLE]);
  await expect(page).toHaveURL(/[?&]q=PAYOUT$/);
  await expect(field).toBeFocused();

  // Escape empties the field and brings the list back.
  await page.keyboard.press("Escape");
  await expect(field).toHaveValue("");
  await expect(titles).not.toHaveCount(1);
  await expect(page).not.toHaveURL(/q=/);

  // A filter hides the only match: the miss counts it and offers it.
  await page.goto("/?q=payout&review=new");
  await expect(
    page.getByRole("heading", { name: "No pull requests match in this view" }),
  ).toBeVisible();
  await expect(
    page.getByText("1 more matches with the filters off."),
  ).toBeVisible();
  await clickUntilLanded(
    page.getByRole("button", { name: "Show all matches" }),
    () => expect(titles).toHaveText([PAYOUT_TITLE], { timeout: 1000 }),
  );
  await expect(page).toHaveURL(/q=payout/);
  await expect(page).not.toHaveURL(/review=/);
  // The button left with the miss; focus moved to the field, not the page.
  await expect(field).toBeFocused();

  // Nothing matches anywhere: the miss names the text and clears it.
  await field.fill("kubernetes");
  await expect(
    page.getByRole("heading", {
      name: "No pull requests match “kubernetes”",
    }),
  ).toBeVisible();
  // The field's own clear button carries the same name without the words.
  const clearSearch = page.getByRole("button", { name: "Clear search" });
  await clearSearch.filter({ hasText: "Clear search" }).click();
  await expect(field).toHaveValue("");
  await expect(field).toBeFocused();
  await expect(titles).not.toHaveCount(0);

  expect(faults).toEqual([]);
});
