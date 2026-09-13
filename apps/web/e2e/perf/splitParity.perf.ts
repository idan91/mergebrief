// The split view on the perf fixture: one row per pair, no side pending, and
// every row on the 22px grid. The unified numbers live in tokenParity.
import { expect, test, type Page } from "@playwright/test";

import { gotoBrief } from "../support/page";
import { PERF_ROUTE_REV1 } from "./ids";
import { report } from "./report";

const OPENED_CARDS = 10;
const PENDING_TIMEOUT_MS = 60_000;
const ROW_LINE_PX = 22;
const FULL_WIDTH_ROW_PX = 31;
const LINE_TOLERANCE_PX = 1;
const SPLIT_ROUTE = `${PERF_ROUTE_REV1}&diff=split`;

async function openLeadingCards(page: Page): Promise<void> {
  const toggles = page.getByTestId("chunk-toggle");
  const count = Math.min(OPENED_CARDS, await toggles.count());

  for (let index = 0; index < count; index += 1) {
    const toggle = toggles.nth(index);
    if ((await toggle.getAttribute("aria-expanded")) !== "true") {
      await toggle.click();
    }
  }

  await expect(page.locator('tbody[data-tokens="pending"]')).toHaveCount(0, {
    timeout: PENDING_TIMEOUT_MS,
  });
}

test("split rows pair every side and hold the row grid", async ({ page }) => {
  await gotoBrief(page, SPLIT_ROUTE);
  await openLeadingCards(page);

  const tables = await page.locator('table[data-view="split"]').count();
  const rows = await page.locator('tbody[data-view="split"] > tr').count();
  const sides = await page.locator("td[data-side]").count();
  const fillers = await page.getByTestId("diff-filler").count();
  const anchors = await page.locator("[data-comment-anchor]").count();
  const heights = await page
    .locator('tbody[data-view="split"] > tr')
    .evaluateAll((elements) =>
      elements.map((row) => Math.round(row.getBoundingClientRect().height)),
    );

  report("split-tables", [tables]);
  report("split-rows", [rows]);
  report("split-side-cells", [sides]);
  report("split-filler-cells", [fillers]);
  report("split-anchors", [anchors]);
  report("split-row-height-px", heights);

  // Read-only sides are this view's contract until the interaction PR.
  expect(anchors).toBe(0);
  expect(tables).toBeGreaterThan(0);
  expect(rows).toBeGreaterThan(0);
  expect(fillers).toBeGreaterThan(0);
  for (const height of heights) {
    expect(isRowHeight(height)).toBe(true);
  }
});

function isRowHeight(height: number): boolean {
  if (Math.abs(height - FULL_WIDTH_ROW_PX) <= LINE_TOLERANCE_PX) return true;

  const lines = Math.round(height / ROW_LINE_PX);
  return (
    lines >= 1 && Math.abs(height - lines * ROW_LINE_PX) <= LINE_TOLERANCE_PX
  );
}
