// Navigation and scroll measurement on the generated large fixture:
//   jump-far-chunk: toc click on the far group until the scroll settles
//   jump-landing-offset-px: px the scroll stopped from its target, 0 = clean
//   scroll-*: scripted full-page scroll, rAF frame-gap distribution
// Scroll offsets are ASSERTED, not just recorded: the windowed jump path
// (instant scroll + settle-correction) owns placement within the correction
// threshold, cold and warmed.
import { expect, test, type Locator, type Page } from "@playwright/test";

import { gotoBrief } from "../support/page";
import { PERF_ROUTE_REV1 } from "./ids";
import { p95, report } from "./report";

const SAMPLES = 5;
/** Matches the scroller's correction threshold: a scroll inside it is
 * deliberately left uncorrected. */
const SCROLL_TOLERANCE_PX = 8;

/** Toc lines carry the group name as their accessible name. */
function tocButtons(page: Page): Locator {
  return page.getByRole("button", { name: /^Group \d+: rework synthetic/ });
}

/** First chunk card of a story-group section. */
function getFirstChunk(section: Locator): Locator {
  return section.getByTestId("brief-chunk").first();
}

/**
 * Resolve once scrollY has held still for ~10 consecutive frames. Capped at
 * ~5s of frames: a scroll that never settles (e.g. a reveal↔remeasure
 * oscillation) must fail naming its position, not hang to the test timeout.
 */
async function waitForScrollSettled(page: Page): Promise<void> {
  await page.evaluate(
    async () =>
      new Promise<void>((resolve, reject) => {
        let stableFrames = 0;
        let totalFrames = 0;
        let lastY = window.scrollY;
        const tick = () => {
          totalFrames += 1;
          if (window.scrollY === lastY) {
            stableFrames += 1;
          } else {
            stableFrames = 0;
          }
          lastY = window.scrollY;
          if (stableFrames >= 10) {
            resolve();
          } else if (totalFrames > 300) {
            reject(
              new Error(
                `scroll never settled; scrollY=${String(window.scrollY)}`,
              ),
            );
          } else {
            requestAnimationFrame(tick);
          }
        };
        requestAnimationFrame(tick);
      }),
  );
}

/** Px the element sits outside the viewport (0 = some part visible). */
async function measureScrollOffset(target: Locator): Promise<number> {
  return target.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    if (rect.bottom < 0) {
      return Math.round(-rect.bottom);
    }
    if (rect.top > window.innerHeight) {
      return Math.round(rect.top - window.innerHeight);
    }
    return 0;
  });
}

test("jump to far chunk timing", async ({ page }) => {
  await gotoBrief(page, PERF_ROUTE_REV1, {
    timeout: 90_000,
  });

  const sections = page.locator("main").getByTestId("story-group");
  const toc = tocButtons(page);
  expect(await toc.count()).toBeGreaterThan(1);

  const firstTarget = getFirstChunk(sections.first());
  const lastTarget = getFirstChunk(sections.last());

  // The very first far jump navigates over never-revealed diffs whose
  // heights are still estimates, so its miss distance is the honest cold
  // number. Later jumps ride remembered sizes (`contain-intrinsic-block-size:
  // auto` keeps the real size after first reveal) and place clean.
  await toc.last().click();
  await waitForScrollSettled(page);
  const coldOffset = await measureScrollOffset(lastTarget);
  report("jump-cold-landing-offset-px", [coldOffset]);
  expect(coldOffset).toBeLessThanOrEqual(SCROLL_TOLERANCE_PX);
  await toc.first().click();
  await waitForScrollSettled(page);

  const times: number[] = [];
  const offsets: number[] = [];
  for (let i = 0; i < SAMPLES; i += 1) {
    const start = Date.now();
    await toc.last().click();
    await waitForScrollSettled(page);
    times.push(Date.now() - start);
    offsets.push(await measureScrollOffset(lastTarget));

    // Return trip resets the starting point; recorded into the same series:
    // the far jump is symmetric and one metric keeps the report readable.
    await toc.first().click();
    await waitForScrollSettled(page);
    offsets.push(await measureScrollOffset(firstTarget));
  }
  report("jump-far-chunk", times);
  report("jump-landing-offset-px", offsets);
  for (const offset of offsets) {
    expect(offset).toBeLessThanOrEqual(SCROLL_TOLERANCE_PX);
  }
});

/** Four seconds of frames at 60Hz: the traversal's length in frames. */
const TRAVERSAL_FRAME_STEPS = 240;
/** The slowest average frame a 240-step traversal may run, about 15fps. */
const MEAN_FRAME_GAP_BUDGET_MS = 65;

/** One scripted top-to-bottom traversal, read back from the page. */
interface FrameTraversal {
  gaps: number[];
  advancedFrames: number;
  bottomShortfallPx: number;
  stepPx: number;
}

/**
 * Steps the window one equal slice of its height per frame, top to bottom, so
 * the sample count and each frame's scroll distance do not depend on how slow
 * the frames are.
 */
function traverseByFrames(page: Page): Promise<FrameTraversal> {
  return page.evaluate(async (frameSteps: number) => {
    window.scrollTo({ top: 0, behavior: "instant" });
    return new Promise<FrameTraversal>((resolve) => {
      const gaps: number[] = [];
      let last: number | undefined;
      let step = 0;
      let advancedFrames = 0;
      let stepStartY = window.scrollY;
      let stepPx = 0;
      const tick = (now: number) => {
        if (last !== undefined) {
          gaps.push(now - last);
        }
        last = now;
        const advanced = step > 0 && window.scrollY > stepStartY;
        if (advanced) {
          advancedFrames += 1;
        }
        // Ceiling re-read per tick: revealing below-fold content grows the
        // real scrollHeight mid-traversal, and a stale total would stop the
        // loop short of the true bottom.
        const ceiling =
          document.documentElement.scrollHeight - window.innerHeight;
        if (step === frameSteps) {
          const bottomShortfallPx = ceiling - window.scrollY;
          resolve({ gaps, advancedFrames, bottomShortfallPx, stepPx });
          return;
        }
        step += 1;
        stepStartY = window.scrollY;
        stepPx = ceiling / frameSteps;
        window.scrollTo({ top: step * stepPx, behavior: "instant" });
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  }, TRAVERSAL_FRAME_STEPS);
}

test("scroll frame gaps", async ({ page }) => {
  await gotoBrief(page, PERF_ROUTE_REV1, {
    timeout: 90_000,
  });

  // Every gap between consecutive traversal frames is a sample. A long gap =
  // a frame the main thread could not produce, the jank virtualization must
  // not add to. Instant behavior per step: the CSS `scroll-behavior: smooth`
  // would otherwise animate toward each step and the page would never
  // traverse its real height inside the loop.
  const traversal = await traverseByFrames(page);
  const { gaps } = traversal;
  const traversalMs = gaps.reduce((total, gap) => total + gap, 0);
  const meanGapMs = traversalMs / gaps.length;

  report("scroll-frame-samples", [gaps.length]);
  report("scroll-traversal-ms", [traversalMs]);
  report("scroll-mean-frame-gap", [meanGapMs]);
  report("scroll-p95-frame-gap", [p95(gaps)]);
  report("scroll-max-frame-gap", [Math.max(...gaps)]);

  // A valid sample set: every step moved the window, and the last step landed
  // at the bottom the page had grown to by then.
  expect(traversal.advancedFrames).toBe(TRAVERSAL_FRAME_STEPS);
  expect(traversal.bottomShortfallPx).toBeLessThanOrEqual(traversal.stepPx);
  expect(meanGapMs).toBeLessThanOrEqual(MEAN_FRAME_GAP_BUDGET_MS);
});
