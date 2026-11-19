// A Back while the search field's own writes are still loading. The field
// wrote the very text Back lands on, so the address alone cannot tell the
// two apart: the field has to take the entry's text, not keep its own.
import { expect, test } from "@playwright/test";

import { collectPageFaults } from "../support/console";
import { waitForFirstLoad, waitForInteractive } from "../support/page";

const SEARCH_READS = "**/api/inbox?*q=*";
/** Longer than the field's pause, so each burst of typing is written. */
const PAST_THE_PAUSE_MS = 400;

test("Back onto an older search puts that search in the field", async ({
  page,
}) => {
  const faults = collectPageFaults(page);
  await page.goto("/?q=ledg&review=updated");
  await waitForFirstLoad(page);
  await waitForInteractive(page);
  const field = page.getByRole("searchbox", {
    name: "Search briefs by title or number",
  });
  await expect(field).toHaveValue("ledg");

  // A second history entry: Home with no search.
  await page.getByRole("link", { name: "MergeBrief", exact: true }).click();
  await expect(page).not.toHaveURL(/q=/);
  await expect(field).toHaveValue("");

  // Hold every search read, so nothing the field writes arrives.
  let releaseReads = (): void => undefined;
  const held = new Promise<void>((resolve) => {
    releaseReads = resolve;
  });
  await page.route(SEARCH_READS, async (route) => {
    await held;
    await route.continue();
  });
  await page.keyboard.press("/");
  await page.keyboard.type("ledg");
  await page.waitForTimeout(PAST_THE_PAUSE_MS);
  await page.keyboard.type("er");
  await page.waitForTimeout(PAST_THE_PAUSE_MS);
  await expect(field).toHaveValue("ledger");

  await page.goBack();
  releaseReads();

  await expect(page).toHaveURL(/q=ledg&review=updated$/);
  await expect(field).toHaveValue("ledg");
  // The entry Back left holds the field's last write; Forward brings it back.
  await page.goForward();
  await expect(page).toHaveURL(/[?&]q=ledger$/);
  await expect(field).toHaveValue("ledger");

  expect(faults).toEqual([]);
});
