// The story surface's interactive affordances — disclosure and jump
// behaviours that only exist once the page is hydrated, and that jsdom cannot
// judge because they turn on layout and real focus.
import { expect, test } from "@playwright/test";

import { FIXTURE_BRIEF_REV2 } from "../fixtures/ids";
import { gotoBrief, shortcutsDialog } from "../support/page";

test("chunk cards collapse and expand", async ({ page }) => {
  await gotoBrief(page, `/briefs/${FIXTURE_BRIEF_REV2}`);

  // `#c1` stays: chunk ids ARE the deep-link anchor contract. The toggle
  // rides its testid instead of DOM order.
  const card = page.locator("article#c1");
  const toggle = card.getByTestId("chunk-toggle");
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(card.locator("[data-line-kind]").first()).toBeVisible();

  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(card.locator("[data-line-kind]").first()).toBeHidden();

  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(card.locator("[data-line-kind]").first()).toBeVisible();
});

test("the PR description discloses on demand", async ({ page }) => {
  await gotoBrief(page, `/briefs/${FIXTURE_BRIEF_REV2}`);

  const toggle = page.getByTestId("pr-description-toggle");
  await expect(toggle).toHaveText("Show original PR description");
  await toggle.click();
  await expect(toggle).toHaveText("Hide original PR description");
  await expect(page.getByTestId("pr-description")).toContainText(
    "Fix WCAG AA contrast on the faint text token",
  );
});

test("the risk-attrs disclosure jumps to the carrying group", async ({
  page,
}) => {
  await gotoBrief(page, `/briefs/${FIXTURE_BRIEF_REV2}`);

  // The label compresses to "Attrs" below 1280, so match either form.
  const rail = page.getByRole("button", { name: /attrs/i });
  await expect(rail).toHaveAttribute("aria-expanded", "false");
  await rail.click();
  await expect(rail).toHaveAttribute("aria-expanded", "true");

  // `hot-path` is carried by exactly one chunk in the fixture (viewModel.ts,
  // the second change group's first chunk), so the jump target is
  // unambiguous — the group lands with that chunk at the top of the
  // viewport, which is a layout fact only a real browser can judge.
  const jump = page.getByRole("button", { name: /hot-path ×1/ });
  await expect(jump).toBeVisible();
  await expect(page.locator("article#c3")).not.toBeInViewport();

  await jump.click();

  await expect(page.locator("article#c3")).toBeInViewport();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          document.getElementById("c3")?.getBoundingClientRect().top ??
          Number.NaN,
      ),
    )
    // Below the sticky stack (header ~97px + reading toolbar ~45px), with a
    // little slack — "at the top" now means under the pinned chrome.
    .toBeLessThan(160);
});

test("the shortcuts modal opens with ? and closes with Escape", async ({
  page,
}) => {
  await gotoBrief(page, `/briefs/${FIXTURE_BRIEF_REV2}`);
  const dialog = shortcutsDialog(page);

  await page.keyboard.press("Shift+Slash");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("Next chunk")).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});
