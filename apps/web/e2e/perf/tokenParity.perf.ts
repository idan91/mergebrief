// Parity gates for the coloured diff rows: the anchor, row and a11y-line
// counts must not move when tokens paint, and the worker's tokenize time
// stays under the budget. The plain pass removes the Worker constructor so
// the same fixture renders through the untokenized path in the same test.
import { expect, test, type Browser, type Page } from "@playwright/test";

import { gotoBrief } from "../support/page";
import { PERF_ROUTE_REV1 } from "./ids";
import { report } from "./report";

const OPENED_CARDS = 10;
const PENDING_TIMEOUT_MS = 60_000;
const TOKENIZE_BUDGET_MS = 314;
const PAINT_BUDGET_MS = 2_000;
const ROW_HEIGHTS_PX = [22, 31];

interface RowCounts {
  anchors: number;
  rows: number;
  spans: number;
  a11yLines: number;
}

/** Opens the leading cards and returns the ms from the last click to no row pending. */
async function openLeadingCards(page: Page): Promise<number> {
  const toggles = page.getByTestId("chunk-toggle");
  const count = Math.min(OPENED_CARDS, await toggles.count());

  for (let index = 0; index < count; index += 1) {
    const toggle = toggles.nth(index);
    const expanded = await toggle.getAttribute("aria-expanded");
    if (expanded !== "true") await toggle.click();
  }

  const clickedAt = Date.now();
  await expect(page.locator('tbody[data-tokens="pending"]')).toHaveCount(0, {
    timeout: PENDING_TIMEOUT_MS,
  });

  return Date.now() - clickedAt;
}

async function readCounts(page: Page, label: string): Promise<RowCounts> {
  const counts: RowCounts = {
    anchors: await page.locator("[data-comment-anchor]").count(),
    rows: await page.locator("tr[data-line-kind]").count(),
    spans: await page.locator('td span[class*="syn-"]').count(),
    a11yLines: (await page.locator("body").ariaSnapshot()).split("\n").length,
  };

  report(`${label}-anchors`, [counts.anchors]);
  report(`${label}-rows`, [counts.rows]);
  report(`${label}-token-spans`, [counts.spans]);
  report(`${label}-a11y-lines`, [counts.a11yLines]);

  return counts;
}

async function measurePlain(browser: Browser): Promise<RowCounts> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.addInitScript(() => {
    Object.defineProperty(window, "Worker", { value: undefined });
  });
  await gotoBrief(page, PERF_ROUTE_REV1);
  await openLeadingCards(page);
  const counts = await readCounts(page, "plain-opened");
  await context.close();

  return counts;
}

test("coloured rows keep anchors, rows and a11y lines", async ({
  browser,
  page,
}) => {
  const plain = await measurePlain(browser);

  await gotoBrief(page, PERF_ROUTE_REV1);
  const paintMs = await openLeadingCards(page);
  const coloured = await readCounts(page, "colour-opened");
  report("click-to-painted-ms", [paintMs]);
  expect(paintMs).toBeLessThanOrEqual(PAINT_BUDGET_MS);

  expect(coloured.anchors).toBe(plain.anchors);
  expect(coloured.rows).toBe(plain.rows);
  // Equal, not merely no fewer: colour adds spans, and a span carries no
  // accessible name, so the tree the reader hears must not move at all.
  expect(coloured.a11yLines).toBe(plain.a11yLines);
  expect(plain.spans).toBe(0);
  expect(coloured.spans).toBeGreaterThan(0);

  const timings = await page.evaluate(() => {
    const entries = performance.getEntriesByName("diff-tokens:tokenize");
    return entries.map((entry) => entry.duration);
  });
  const leadingTotal = timings
    .slice(0, OPENED_CARDS)
    .reduce((total, sample) => total + sample, 0);
  report("tokenize-ms-per-chunk", timings);
  report("tokenize-ms-leading-cards", [leadingTotal]);
  expect(timings.length).toBeGreaterThanOrEqual(OPENED_CARDS);
  expect(leadingTotal).toBeLessThanOrEqual(TOKENIZE_BUDGET_MS);

  const heights = await page
    .locator("tr[data-line-kind]")
    .evaluateAll((rows) =>
      rows.map((row) => row.getBoundingClientRect().height),
    );
  report("row-height-px", heights);
  for (const height of heights) {
    expect(ROW_HEIGHTS_PX).toContain(Math.round(height));
  }
});
