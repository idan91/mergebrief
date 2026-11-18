// Scroll to top on the generated large fixture: every click from the end of
// the brief must land at the top.
import { expect, test, type Page } from "@playwright/test";

import { gotoBrief } from "../support/page";
import { PERF_ROUTE_REV1 } from "./ids";

const RUNS = 5;
/** Wider than the sidebar's collapse breakpoint, so the foot control shows. */
const DESKTOP_VIEWPORT = { width: 1440, height: 900 } as const;
const SETTLED_FRAMES = 20;
const MAX_FRAMES = 900;

async function waitForScrollSettled(page: Page): Promise<void> {
  await page.evaluate(
    async ({ settledFrames, maxFrames }) =>
      new Promise<void>((resolve) => {
        let stableFrames = 0;
        let totalFrames = 0;
        let lastY = window.scrollY;
        const tick = () => {
          totalFrames += 1;
          stableFrames = window.scrollY === lastY ? stableFrames + 1 : 0;
          lastY = window.scrollY;
          if (stableFrames >= settledFrames || totalFrames > maxFrames) {
            resolve();
          } else {
            requestAnimationFrame(tick);
          }
        };
        requestAnimationFrame(tick);
      }),
    { settledFrames: SETTLED_FRAMES, maxFrames: MAX_FRAMES },
  );
}

test("scroll to top lands at the top from the end of a long brief", async ({
  page,
}) => {
  await page.setViewportSize(DESKTOP_VIEWPORT);
  await gotoBrief(page, PERF_ROUTE_REV1);
  const scrollToTop = page.getByRole("button", { name: "Scroll to top" });

  const landings: number[] = [];
  for (let run = 0; run < RUNS; run += 1) {
    await page.evaluate(() => {
      window.scrollTo({
        top: document.documentElement.scrollHeight,
        behavior: "instant",
      });
    });
    await waitForScrollSettled(page);
    await scrollToTop.click();
    await waitForScrollSettled(page);
    landings.push(await page.evaluate(() => window.scrollY));
  }

  expect(landings).toEqual(Array.from({ length: RUNS }, () => 0));
});
