// React render work under a pointer gesture, counted by the same commit
// hook the scroll specs use:
//   drag-select-*: a line-selection drag down one diff table
import { expect, test, type Page } from "@playwright/test";

import { gotoBrief } from "../support/page";
import {
  installCommitHook,
  reportCommitStats,
  startCommitTracking,
  stopCommitTracking,
  sumSamples,
} from "./commit-stats";
import { PERF_ROUTE_REV1 } from "./ids";

interface DragPoint {
  x: number;
  y: number;
}

/** Rows the drag crosses: enough to show a per-row cost, few enough to fit one viewport. */
const DRAG_ROWS = 12;
const SETTLE_MS = 250;
const PENDING_TIMEOUT_MS = 60_000;
const GOTO_TIMEOUT_MS = 90_000;

/**
 * The line-number cells of consecutive commentable rows in one diff table,
 * scrolled under the sticky header so every point is on screen.
 */
async function readDragPoints(page: Page): Promise<DragPoint[]> {
  return page.evaluate(
    async ({ rowCount, settleMs }) => {
      const isShown = (row: HTMLElement | undefined): boolean =>
        row !== undefined && row.offsetParent !== null;
      const tables = [...document.querySelectorAll("table")];
      const rowsByTable = tables.map((table) =>
        [...table.querySelectorAll<HTMLElement>("tr[data-commentable]")].filter(
          (row) => row.querySelector("[data-line-new]") !== null,
        ),
      );
      const rows = rowsByTable.find(
        (candidates) => candidates.length >= rowCount && isShown(candidates[0]),
      );
      if (rows === undefined) {
        throw new Error("no diff table with enough commentable rows");
      }
      rows[0]?.scrollIntoView({ block: "center", behavior: "instant" });
      await new Promise((resolve) => {
        setTimeout(resolve, settleMs);
      });
      return rows.slice(0, rowCount).map((row) => {
        const cell = row.querySelector("[data-line-new]");
        const box = (cell ?? row).getBoundingClientRect();
        return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
      });
    },
    { rowCount: DRAG_ROWS, settleMs: SETTLE_MS },
  );
}

test.beforeEach(async ({ page }) => {
  await installCommitHook(page);
});

test("render work during a line-selection drag", async ({ page }) => {
  await gotoBrief(page, PERF_ROUTE_REV1, { timeout: GOTO_TIMEOUT_MS });
  const points = await readDragPoints(page);
  await expect(page.locator('tbody[data-tokens="pending"]')).toHaveCount(0, {
    timeout: PENDING_TIMEOUT_MS,
  });
  const [start, ...rest] = points;
  if (start === undefined) {
    throw new Error("no drag start");
  }

  await page.mouse.move(start.x, start.y);
  await startCommitTracking(page);
  await page.mouse.down();
  for (const point of rest) {
    await page.mouse.move(point.x, point.y);
  }
  await page.waitForTimeout(SETTLE_MS);
  const stats = await stopCommitTracking(page);
  const selectedRows = await page.locator("tr[data-selected]").count();
  await page.mouse.up();

  // The gesture canary: a drag that selected nothing measured nothing. Rows
  // between two commentable ones join the range, so the count can run over.
  expect(selectedRows).toBeGreaterThanOrEqual(DRAG_ROWS);
  expect(sumSamples(stats.renderedComponents)).toBeGreaterThan(0);
  reportCommitStats("drag-select", stats);
});
