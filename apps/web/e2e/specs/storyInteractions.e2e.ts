// The story surface's interactive affordances: disclosure and jump
// behaviours that only exist once the page is hydrated, and that jsdom cannot
// judge because they turn on layout and real focus.
import { expect, test } from "@playwright/test";

import { FIXTURE_ROUTE_REV2 } from "../fixtures/ids";
import { gotoBrief, shortcutsDialog } from "../support/page";

test("chunk cards collapse and expand", async ({ page }) => {
  await gotoBrief(page, FIXTURE_ROUTE_REV2);

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
  await gotoBrief(page, FIXTURE_ROUTE_REV2);

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
  await gotoBrief(page, FIXTURE_ROUTE_REV2);

  // Collapse the target BEFORE opening the rail disclosure (an outside
  // click would dismiss it): a risk-attr jump is wayfinding, and a
  // wayfinding landing respects the user's collapse. Clicking the toggle
  // scrolls c3 into view, so return to the top afterwards.
  const targetToggle = page.locator("article#c3").getByTestId("chunk-toggle");
  await targetToggle.click();
  await expect(targetToggle).toHaveAttribute("aria-expanded", "false");
  await page.evaluate(() => {
    window.scrollTo({ top: 0, behavior: "instant" });
  });

  // The label compresses to "Attrs" below 1280, so match either form.
  const rail = page.getByRole("button", { name: /attrs/i });
  await expect(rail).toHaveAttribute("aria-expanded", "false");
  await rail.click();
  await expect(rail).toHaveAttribute("aria-expanded", "true");

  // `hot-path` is carried by exactly one chunk in the fixture (viewModel.ts,
  // the second change group's first chunk), so the jump target is
  // unambiguous: the group lands with that chunk at the top of the
  // viewport, which is a layout fact only a real browser can judge.
  const jump = page.getByRole("button", { name: /hot-path ×1/ });
  await expect(jump).toBeVisible();
  await expect(page.locator("article#c3")).not.toBeInViewport();

  await jump.click();

  await expect(page.locator("article#c3")).toBeInViewport();
  await expect(targetToggle).toHaveAttribute("aria-expanded", "false");
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          document.getElementById("c3")?.getBoundingClientRect().top ??
          Number.NaN,
      ),
    )
    // Below the sticky stack (header ~97px + reading toolbar ~45px), with a
    // little slack; "at the top" now means under the pinned chrome.
    .toBeLessThan(160);
});

test("the shortcuts modal opens with ? and closes with Escape", async ({
  page,
}) => {
  await gotoBrief(page, FIXTURE_ROUTE_REV2);
  const dialog = shortcutsDialog(page);

  await page.keyboard.press("Shift+Slash");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("Next chunk")).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});

test("focus mode quiets the header and lands the chunk below the pill", async ({
  page,
}) => {
  await gotoBrief(page, FIXTURE_ROUTE_REV2);
  const readTopBar = () =>
    page.evaluate(() =>
      Number.parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue(
          "--top-bar-h",
        ),
      ),
    );
  const restingTopBar = await readTopBar();

  await page.keyboard.press("z");
  const pill = page.getByRole("group", { name: "Focus mode", exact: true });
  await expect(pill).toBeVisible();
  await expect.poll(readTopBar).toBeLessThan(restingTopBar);

  const chunk = page.locator("main article[data-current]");
  await expect
    .poll(async () => {
      const pillBox = await pill.boundingBox();
      const chunkBox = await chunk.boundingBox();
      if (!pillBox || !chunkBox) {
        return -1;
      }
      return chunkBox.y - (pillBox.y + pillBox.height);
    })
    .toBeGreaterThanOrEqual(0);
});

test("the chunk footer steps on and keeps focus on its button", async ({
  page,
}) => {
  await gotoBrief(page, FIXTURE_ROUTE_REV2);
  await page.keyboard.press("z");
  const footer = page.getByTestId("chunk-footer");
  const current = page.locator("main article[data-current]");
  const firstId = await current.getAttribute("id");

  await expect(
    footer.getByRole("button", { name: "Previous chunk" }),
  ).toHaveAttribute("aria-disabled", "true");
  const next = footer.getByRole("button", { name: /^Next/ });
  await next.focus();
  await page.keyboard.press("Enter");

  await expect(current).not.toHaveAttribute("id", firstId ?? "");
  await expect(next).toBeFocused();
});

test("focus mode and its chunk survive a reload through the URL", async ({
  page,
}) => {
  await gotoBrief(page, FIXTURE_ROUTE_REV2);
  await page.keyboard.press("z");
  await page.keyboard.press("j");
  const current = page.locator("main article[data-current]");
  await expect(page).toHaveURL(/focus=true/);
  const chunkId = await current.getAttribute("id");
  await expect(page).toHaveURL(new RegExp(`l=${chunkId ?? ""}`));

  await page.reload();
  await expect(
    page.getByRole("group", { name: "Focus mode", exact: true }),
  ).toBeVisible();
  await expect(current).toHaveAttribute("id", chunkId ?? "");
});

test("the focus panel hides for a group and returns on the next", async ({
  page,
}) => {
  await gotoBrief(page, FIXTURE_ROUTE_REV2);
  await page.keyboard.press("z");
  const panel = page.getByTestId("focus-panel");
  await expect(panel).toHaveAttribute("data-state", "open");

  await page.keyboard.press("s");
  await expect(panel).toHaveAttribute("data-state", "closed");
  await page.keyboard.press("j");
  await expect(page.locator("main article[data-current]")).toHaveId("c2");
  await expect(panel).toHaveAttribute("data-state", "closed");

  await page.keyboard.press("Shift+J");
  await expect(panel).toHaveAttribute("data-state", "open");

  await page.keyboard.press("Escape");
  await expect(panel).toHaveAttribute("data-state", "closed");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("focus-indicator")).toHaveCount(0);
});

test("S reopening the panel from its tab moves focus to the heading", async ({
  page,
}) => {
  await gotoBrief(page, FIXTURE_ROUTE_REV2);
  await page.keyboard.press("z");
  const panel = page.getByTestId("focus-panel");
  await expect(panel).toHaveAttribute("data-state", "open");

  await page.keyboard.press("s");
  const tab = page.getByTestId("focus-panel-tab");
  await tab.focus();
  await page.keyboard.press("s");

  await expect(panel).toHaveAttribute("data-state", "open");
  await expect(panel.getByRole("heading", { level: 2 })).toBeFocused();
});
