// Parity gates for the coloured diff rows: the anchor, row and a11y-line
// counts must not move when tokens paint, and the worker's tokenize time
// stays under the budget. The plain pass removes the Worker constructor so
// the same fixture renders through the untokenized path in the same test.
import { expect, test, type Browser, type Page } from "@playwright/test";

import { STORAGE_STATE_PATH } from "../harness/env";
import { gotoBrief } from "../support/page";
import { PERF_ROUTE_REV1 } from "./ids";
import { report } from "./report";

const OPENED_CARDS = 10;
const PENDING_TIMEOUT_MS = 60_000;
const TOKENIZE_BUDGET_MS = 314;
const PAINT_BUDGET_MS = 2_000;
const ROW_LINE_PX = 22;
const FULL_WIDTH_ROW_PX = 31;
const LINE_TOLERANCE_PX = 1;
const DEFAULT_VIEWPORT = { width: 1280, height: 720 };
const SLACK_TOLERANCE_PX = 1;

interface RowCounts {
  anchors: number;
  rows: number;
  spans: number;
  a11yLines: number;
  heights: number[];
  /** Pixels between the plain line's end and the cell's content edge. */
  slack: number[];
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
    heights: await readRowHeights(page),
    slack: await readRowSlack(page),
  };

  report(`${label}-anchors`, [counts.anchors]);
  report(`${label}-rows`, [counts.rows]);
  report(`${label}-token-spans`, [counts.spans]);
  report(`${label}-a11y-lines`, [counts.a11yLines]);

  return counts;
}

async function measurePlain(
  browser: Browser,
  viewport: { width: number; height: number } | null,
): Promise<RowCounts> {
  const context = await browser.newContext({
    storageState: STORAGE_STATE_PATH,
    // Never null: a context without an emulated viewport measures at a
    // different width, and the whole comparison assumes one width.
    viewport: viewport ?? DEFAULT_VIEWPORT,
  });
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
  const plain = await measurePlain(browser, page.viewportSize());

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

  report("row-height-px", coloured.heights);
  // Token spans are shaped as separate runs and can measure a fraction of a
  // pixel wider than one run, so a line whose unwrapped text sits within a
  // pixel of the cell edge may wrap coloured and not plain. Every other row,
  // wrapped ones included, must match exactly.
  const comparable = plain.heights.filter(
    (_height, index) => Math.abs(plain.slack[index] ?? 0) >= SLACK_TOLERANCE_PX,
  );
  const colouredComparable = coloured.heights.filter(
    (_height, index) => Math.abs(plain.slack[index] ?? 0) >= SLACK_TOLERANCE_PX,
  );
  report("row-height-compared", [comparable.length]);
  expect(comparable.length).toBeGreaterThan(0);
  expect(colouredComparable).toEqual(comparable);
  for (const height of coloured.heights) {
    expect(isRowHeight(height)).toBe(true);
  }
});

function readRowSlack(page: Page): Promise<number[]> {
  return page.locator("tr[data-line-kind]").evaluateAll((rows) =>
    rows.map((row) => {
      const code = row.querySelector<HTMLElement>('td[class*="code"]');
      if (code === null) return Number.POSITIVE_INFINITY;
      const style = getComputedStyle(code);
      const content =
        code.clientWidth -
        parseFloat(style.paddingLeft) -
        parseFloat(style.paddingRight);
      // Measured unwrapped: on a wrapped cell the fragments span the full
      // width, so a wrapped row would report no slack and be exempted from
      // the comparison below, which is the row the comparison is for. `pre`,
      // not `nowrap`: nowrap still collapses whitespace, which shrinks a
      // line's indentation and reports slack a wrapped row does not have.
      const previous = code.style.whiteSpace;
      code.style.whiteSpace = "pre";
      const range = document.createRange();
      range.selectNodeContents(code);
      const rects = [...range.getClientRects()];
      code.style.whiteSpace = previous;
      if (rects.length === 0) return Number.POSITIVE_INFINITY;
      const start = Math.min(...rects.map((rect) => rect.left));
      const end = Math.max(...rects.map((rect) => rect.right));

      return content - (end - start);
    }),
  );
}

function readRowHeights(page: Page): Promise<number[]> {
  return page
    .locator("tr[data-line-kind]")
    .evaluateAll((rows) =>
      rows.map((row) => Math.round(row.getBoundingClientRect().height)),
    );
}

/** A code row is a whole number of 22px lines; a hunk or note row is 31px. */
function isRowHeight(height: number): boolean {
  if (Math.abs(height - FULL_WIDTH_ROW_PX) <= LINE_TOLERANCE_PX) return true;

  const lines = Math.round(height / ROW_LINE_PX);
  return (
    lines >= 1 && Math.abs(height - lines * ROW_LINE_PX) <= LINE_TOLERANCE_PX
  );
}
