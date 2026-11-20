// The switch has to stay reachable without single-key shortcuts.
import { expect, test } from "@playwright/test";

import { FIXTURE_ROUTE_REV2 } from "../fixtures/ids";
import {
  gotoSettledBrief,
  shortcutsDialog,
  waitForShortcutsBound,
} from "../support/page";

test("single-key shortcuts turn off and back on from the shortcuts dialog", async ({
  page,
}) => {
  await gotoSettledBrief(page, FIXTURE_ROUTE_REV2);
  const dialog = shortcutsDialog(page);
  const toggle = page.getByText("Single-key shortcuts", { exact: true });

  await page.keyboard.press("Shift+Slash");
  await toggle.click();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();

  await page.keyboard.press("Shift+Slash");
  await page.keyboard.press("z");
  await expect(dialog).toBeHidden();
  await expect(page).not.toHaveURL(/focus=true/);

  await page.reload();
  // The key that usually shows the page answers is off, so only the bound
  // listener is waited for.
  await waitForShortcutsBound(page);
  await page.getByRole("button", { name: "Keyboard shortcuts" }).click();
  await expect(dialog).toBeVisible();
  await expect(
    page.getByRole("checkbox", { name: "Single-key shortcuts" }),
  ).not.toBeChecked();

  await toggle.click();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Shift+Slash");
  await expect(dialog).toBeVisible();
});
