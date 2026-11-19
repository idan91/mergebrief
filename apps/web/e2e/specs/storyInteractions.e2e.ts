// The story surface's interactive affordances: disclosure and jump
// behaviours that only exist once the page is hydrated, and that jsdom cannot
// judge because they turn on layout and real focus.
import { expect, test, type Locator, type Page } from "@playwright/test";

import { FIXTURE_ROUTE_REV2 } from "../fixtures/ids";
import { gotoSettledBrief } from "../support/page";

test("chunk cards collapse and expand", async ({ page }) => {
  await gotoSettledBrief(page, FIXTURE_ROUTE_REV2);

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

test("the risk-attrs disclosure jumps to the carrying group", async ({
  page,
}) => {
  await gotoSettledBrief(page, FIXTURE_ROUTE_REV2);

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

  const rail = page.getByRole("button", { name: /risk attributes/i });
  await expect(rail).toHaveAttribute("aria-expanded", "false");
  await rail.click();
  await expect(rail).toHaveAttribute("aria-expanded", "true");

  // `hot-path` is carried by exactly one chunk in the fixture (viewModel.ts,
  // the second change group's first chunk), so the jump target is
  // unambiguous: the group lands with that chunk at the top of the
  // viewport, which is a layout fact only a real browser can judge.
  const jump = page.getByRole("button", { name: /Hot path ×1/ });
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

test("focus mode quiets the header and lands the chunk below the pill", async ({
  page,
}) => {
  await gotoSettledBrief(page, FIXTURE_ROUTE_REV2);
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

  await test.step("the chunk footer steps on and keeps focus on its button", async () => {
    const footer = page.getByTestId("chunk-footer");
    const firstId = await chunk.getAttribute("id");

    await expect(
      footer.getByRole("button", { name: "Previous chunk" }),
    ).toHaveAttribute("aria-disabled", "true");
    const next = footer.getByRole("button", { name: /^Next/ });
    await next.focus();
    await page.keyboard.press("Enter");

    await expect(chunk).not.toHaveAttribute("id", firstId ?? "");
    await expect(next).toBeFocused();
  });
});

test("focus mode and its chunk survive a reload through the URL", async ({
  page,
}) => {
  await gotoSettledBrief(page, FIXTURE_ROUTE_REV2);
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
  await gotoSettledBrief(page, FIXTURE_ROUTE_REV2);
  await page.keyboard.press("z");
  const panel = page.getByTestId("focus-panel");
  await expect(panel).toHaveAttribute("data-state", "open");

  await page.keyboard.press("s");
  await expect(panel).toHaveAttribute("data-state", "closed");

  await test.step("S from the panel's tab reopens it with focus on the heading", async () => {
    await page.getByTestId("focus-panel-tab").focus();
    await page.keyboard.press("s");

    await expect(panel).toHaveAttribute("data-state", "open");
    await expect(panel.getByRole("heading", { level: 2 })).toBeFocused();

    await page.keyboard.press("s");
    await expect(panel).toHaveAttribute("data-state", "closed");
  });

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

test("the chunk strip follows the scroll and lands its jumps under the stack", async ({
  page,
}) => {
  await gotoSettledBrief(page, FIXTURE_ROUTE_REV2);
  const strip = page
    .getByRole("toolbar", { name: "Chunks in this group" })
    .first();
  const marks = strip.getByRole("button");

  // The scroll-spy reads the chunk crossing the landing line under the
  // pinned stack, so park c2 across it.
  await page.evaluate(() => {
    const target = document.getElementById("c2");
    if (target) {
      const top = target.getBoundingClientRect().top + window.scrollY - 100;
      window.scrollTo({ top, behavior: "instant" });
    }
  });
  await expect(marks.nth(1)).toHaveAttribute("aria-current", "true");

  await marks.nth(0).focus();
  await page.keyboard.press("Enter");
  await expect(marks.nth(0)).toHaveAttribute("aria-current", "true");

  // A strip jump lands the chunk below the stack and keeps its mark.
  await marks.nth(1).click();

  await expect(marks.nth(1)).toHaveAttribute("aria-current", "true");
  const readStackBottom = () =>
    page.evaluate(() =>
      Number.parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue(
          "--sticky-stack-h",
        ),
      ),
    );
  await expect
    .poll(async () => {
      const box = await page.locator("article#c2").boundingBox();
      return box === null ? -1 : box.y - (await readStackBottom());
    })
    .toBeGreaterThanOrEqual(0);
  await expect(marks.nth(1)).toHaveAttribute("aria-current", "true");
});

test("a diff table is one Tab stop and the arrows step its lines", async ({
  page,
}) => {
  await gotoSettledBrief(page, FIXTURE_ROUTE_REV2);
  const table = page.locator("article#c1 table").first();
  const lines = table.locator("[data-line-stop]");
  await expect(table.locator('[tabindex="0"][data-line-stop]')).toHaveCount(1);

  await lines.first().focus();
  await page.keyboard.press("ArrowDown");

  await expect(lines.nth(1)).toBeFocused();
  await expect(table.locator('[tabindex="0"][data-line-stop]')).toHaveCount(1);
  await expect(lines.nth(1)).toHaveAttribute("tabindex", "0");

  await page.keyboard.press("Tab");

  // Tab moves on to the next control, in the table or past it, never to
  // another line.
  const focusIsOnALine = await page.evaluate(
    () => document.activeElement?.hasAttribute("data-line-stop") ?? false,
  );
  expect(focusIsOnALine).toBe(false);

  await test.step("a focused diff line keeps focus across the D view switch", async () => {
    // c1 changes one line, so it pairs a deletion with its addition in split.
    const card = page.locator("article#c1");
    await expect(table).toHaveAttribute("data-view", "unified");
    await lines.first().focus();

    await page.keyboard.press("d");

    await expect(table).toHaveAttribute("data-view", "split");
    await expect(card.locator("[data-line-stop]:focus")).toHaveCount(1);
  });
});

/** Lines the keyboard steps over a sticky edge in the line-stop tests. */
const LINE_STEPS = 4;
/** How far below the stack's bottom the covered line starts: under the card's pinned head. */
const COVERED_INSET_PX = 4;
/** How far above the bottom bar the start line ends, so the next line starts under it. */
const ABOVE_BAR_PX = 2;
/** An upright phone, where a card's pinned head is its two-line phone height. */
const UPRIGHT_PHONE_VIEWPORT = { width: 390, height: 844 };
/** Wide enough for the page, narrow enough that the sidebar is the bottom bar. */
const BOTTOM_BAR_VIEWPORT = { width: 1000, height: 800 };

/** A line's top minus its card's pinned head's bottom: negative while covered. */
function readHeadClearance(line: Locator): Promise<number> {
  return line.evaluate((element) => {
    const head = element.closest("article")?.firstElementChild;
    if (head === null || head === undefined) {
      throw new Error("the line has no card head");
    }
    return (
      element.getBoundingClientRect().top - head.getBoundingClientRect().bottom
    );
  });
}

/**
 * A focused line's top, less how far its focus ring reaches above it, minus
 * its card's pinned head's bottom: negative while the ring is covered.
 */
function readRingClearance(line: Locator): Promise<number> {
  return line.evaluate((element) => {
    const head = element.closest("article")?.firstElementChild;
    if (head === null || head === undefined) {
      throw new Error("the line has no card head");
    }
    const style = getComputedStyle(element);
    const ringReach = Math.max(
      0,
      Number.parseFloat(style.outlineWidth) +
        Number.parseFloat(style.outlineOffset),
    );
    const ringTop = element.getBoundingClientRect().top - ringReach;
    return ringTop - head.getBoundingClientRect().bottom;
  });
}

/**
 * Focuses the last line of `#c2` and scrolls the line `LINE_STEPS` above it
 * under the card's pinned head; returns that covered line.
 */
async function coverLineUnderHead(page: Page): Promise<Locator> {
  await gotoSettledBrief(page, FIXTURE_ROUTE_REV2);
  const lines = page.locator("article#c2 table [data-line-stop]");
  const lineCount = await lines.count();
  const target = lines.nth(lineCount - 1 - LINE_STEPS);
  await lines.last().focus();
  await target.evaluate((line, insetPx) => {
    const stackHeight = Number.parseFloat(
      getComputedStyle(document.documentElement).getPropertyValue(
        "--sticky-stack-h",
      ),
    );
    const top = line.getBoundingClientRect().top - (stackHeight + insetPx);
    window.scrollBy({ top, behavior: "instant" });
  }, COVERED_INSET_PX);
  expect(await readHeadClearance(target)).toBeLessThan(0);
  return target;
}

test("a line stepped to under the sticky bars comes out from under them", async ({
  page,
}) => {
  const target = await coverLineUnderHead(page);

  for (let step = 0; step < LINE_STEPS; step += 1) {
    await page.keyboard.press("ArrowUp");
  }

  await expect(target).toBeFocused();
  await expect.poll(() => readHeadClearance(target)).toBeGreaterThanOrEqual(0);
});

test.describe("an upright phone", () => {
  test.use({
    viewport: UPRIGHT_PHONE_VIEWPORT,
    hasTouch: true,
    isMobile: true,
  });

  test("a line stepped to under the card head clears it with its ring", async ({
    page,
  }) => {
    const target = await coverLineUnderHead(page);

    for (let step = 0; step < LINE_STEPS; step += 1) {
      await page.keyboard.press("ArrowUp");
    }

    await expect(target).toBeFocused();
    await expect
      .poll(() => readRingClearance(target))
      .toBeGreaterThanOrEqual(0);
  });
});

test("a line stepped to over the bottom bar comes out above it", async ({
  page,
}) => {
  await page.setViewportSize(BOTTOM_BAR_VIEWPORT);
  await gotoSettledBrief(page, FIXTURE_ROUTE_REV2);
  const bar = page.getByTestId("sidebar-bar");
  await expect(bar).toBeVisible();
  const lines = page.locator("article#c2 table [data-line-stop]");
  const lineCount = await lines.count();
  const start = lines.nth(lineCount - 1 - LINE_STEPS);
  const target = lines.last();
  await start.focus();
  const barTop = await bar.evaluate(
    (element) => element.getBoundingClientRect().top,
  );
  await start.evaluate((line, bottom) => {
    const top = line.getBoundingClientRect().bottom - bottom;
    window.scrollBy({ top, behavior: "instant" });
  }, barTop - ABOVE_BAR_PX);
  const readBarOverlap = (line: Locator) =>
    line.evaluate(
      (element, top) => element.getBoundingClientRect().bottom - top,
      barTop,
    );
  expect(
    await readBarOverlap(lines.nth(lineCount - LINE_STEPS)),
  ).toBeGreaterThan(0);

  for (let step = 0; step < LINE_STEPS; step += 1) {
    await page.keyboard.press("ArrowDown");
  }

  await expect(target).toBeFocused();
  await expect.poll(() => readBarOverlap(target)).toBeLessThanOrEqual(0);
});
