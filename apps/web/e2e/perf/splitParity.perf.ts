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

/** Where the split tables put their comment anchors, counted per side. */
interface AnchorPlacement {
  leftLines: number;
  rightLines: number;
  singlyAnchoredLines: number;
  crossedLines: number;
  anchorsInLines: number;
  anchorsInFillers: number;
}

function readAnchorPlacement(page: Page): Promise<AnchorPlacement> {
  return page.locator('tbody[data-view="split"]').evaluateAll((bodies) => {
    const placement = {
      leftLines: 0,
      rightLines: 0,
      singlyAnchoredLines: 0,
      crossedLines: 0,
      anchorsInLines: 0,
      anchorsInFillers: 0,
    };
    const crossedKinds: Record<string, string> = { left: "add", right: "del" };

    for (const body of bodies) {
      const lineCells = body.querySelectorAll<HTMLElement>(
        "td[data-side][data-line-kind]:not([data-line-number])",
      );
      for (const cell of lineCells) {
        const side = cell.dataset["side"] ?? "";
        const anchors = cell.querySelectorAll("[data-comment-anchor]").length;
        if (side === "left") {
          placement.leftLines += 1;
        } else {
          placement.rightLines += 1;
        }
        if (anchors === 1) {
          placement.singlyAnchoredLines += 1;
        }
        if (cell.dataset["lineKind"] === crossedKinds[side]) {
          placement.crossedLines += 1;
        }
        placement.anchorsInLines += anchors;
      }
      for (const filler of body.querySelectorAll(
        '[data-testid="diff-filler"]',
      )) {
        placement.anchorsInFillers += filler.querySelectorAll(
          "[data-comment-anchor]",
        ).length;
      }
    }

    return placement;
  });
}

test("split rows pair every side and hold the row grid", async ({ page }) => {
  await gotoBrief(page, SPLIT_ROUTE);
  await openLeadingCards(page);

  const tables = await page.locator('table[data-view="split"]').count();
  const rows = await page.locator('tbody[data-view="split"] > tr').count();
  const sides = await page.locator("td[data-side]").count();
  const fillers = await page.getByTestId("diff-filler").count();
  const anchors = await page
    .locator('tbody[data-view="split"] [data-comment-anchor]')
    .count();
  const placement = await readAnchorPlacement(page);
  const heights = await page
    .locator('tbody[data-view="split"] > tr')
    .evaluateAll((elements) =>
      elements.map((row) => Math.round(row.getBoundingClientRect().height)),
    );
  const lineCells = placement.leftLines + placement.rightLines;

  report("split-tables", [tables]);
  report("split-rows", [rows]);
  report("split-side-cells", [sides]);
  report("split-filler-cells", [fillers]);
  report("split-anchors", [anchors]);
  report("split-left-line-cells", [placement.leftLines]);
  report("split-right-line-cells", [placement.rightLines]);
  report("split-row-height-px", heights);

  // Each side anchors on its own line: one sign anchor per side line cell,
  // none on a filler, and a side only ever holds its own half of the diff.
  expect(placement.leftLines).toBeGreaterThan(0);
  expect(placement.rightLines).toBeGreaterThan(0);
  expect(placement.singlyAnchoredLines).toBe(lineCells);
  expect(placement.anchorsInLines).toBe(anchors);
  expect(placement.anchorsInFillers).toBe(0);
  expect(placement.crossedLines).toBe(0);
  expect(tables).toBeGreaterThan(0);
  expect(rows).toBeGreaterThan(0);
  expect(fillers).toBeGreaterThan(0);
  for (const height of heights) {
    expect(isRowHeight(height)).toBe(true);
  }
});

function isRowHeight(height: number): boolean {
  if (Math.abs(height - FULL_WIDTH_ROW_PX) <= LINE_TOLERANCE_PX) {
    return true;
  }

  const lines = Math.round(height / ROW_LINE_PX);
  return (
    lines >= 1 && Math.abs(height - lines * ROW_LINE_PX) <= LINE_TOLERANCE_PX
  );
}
