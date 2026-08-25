// Navigation + scroll measurement on the generated large fixture:
//   jump-far-chunk         — toc click on the far group → scroll settled
//   jump-landing-offset-px — how far from the target the scroll actually
//                            stopped (0 = landed clean)
//   scroll-*               — scripted full-page scroll, rAF frame-gap
//                            distribution
// Baselines for the list-virtualization work: the jump path must land
// correctly once far chunks stop being mounted, and the frame gaps bound how
// much windowing is allowed to cost during scroll.
//
// Landing offsets are ASSERTED, not just recorded: the windowed jump path
// (instant scroll + settle-correction) owns landing within the correction
// threshold, cold and warmed. Pre-virtualization these were report-only —
// a cold far jump genuinely mis-landed (~250-580px of cv estimate drift).
import { expect, test, type Locator, type Page } from "@playwright/test";

import { gotoBrief } from "../support/page";
import { PERF_ROUTE_REV1 } from "./ids";
import { p95, report } from "./report";

const SAMPLES = 5;
/** Matches the scroller's correction threshold: a landing inside it is
 * deliberately left uncorrected. */
const LANDING_TOLERANCE_PX = 8;

/** Toc lines carry the group name as their accessible name. */
function tocButtons(page: Page): Locator {
  return page.getByRole("button", { name: /^Group \d+: rework synthetic/ });
}

/** First chunk card of a story-group section (GroupCard is outside `.group-chunks`). */
function getFirstChunk(section: Locator): Locator {
  return section.locator(".group-chunks article[id]").first();
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
          if (window.scrollY === lastY) stableFrames += 1;
          else stableFrames = 0;
          lastY = window.scrollY;
          if (stableFrames >= 10) resolve();
          else if (totalFrames > 300)
            reject(
              new Error(
                `scroll never settled; scrollY=${String(window.scrollY)}`,
              ),
            );
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
  );
}

/** Px the element sits outside the viewport (0 = some part visible). */
async function landingOffset(target: Locator): Promise<number> {
  return target.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    if (rect.bottom < 0) return Math.round(-rect.bottom);
    if (rect.top > window.innerHeight)
      return Math.round(rect.top - window.innerHeight);
    return 0;
  });
}

test("jump to far chunk timing", async ({ page }) => {
  await gotoBrief(page, PERF_ROUTE_REV1, {
    timeout: 90_000,
  });

  const sections = page.locator("main section.story-group");
  const toc = tocButtons(page);
  expect(await toc.count()).toBeGreaterThan(1);

  const firstTarget = getFirstChunk(sections.first());
  const lastTarget = getFirstChunk(sections.last());

  // The very first far jump navigates over never-revealed diffs whose
  // heights are still estimates — its miss distance is the honest cold
  // number. Later jumps ride remembered sizes (`contain-intrinsic-block-size:
  // auto` keeps the real size after first reveal) and land clean.
  await toc.last().click();
  await waitForScrollSettled(page);
  const coldOffset = await landingOffset(lastTarget);
  report("jump-cold-landing-offset-px", [coldOffset]);
  expect(coldOffset).toBeLessThanOrEqual(LANDING_TOLERANCE_PX);
  await toc.first().click();
  await waitForScrollSettled(page);

  const times: number[] = [];
  const offsets: number[] = [];
  for (let i = 0; i < SAMPLES; i += 1) {
    const start = Date.now();
    await toc.last().click();
    await waitForScrollSettled(page);
    times.push(Date.now() - start);
    offsets.push(await landingOffset(lastTarget));

    // Return trip resets the starting point; recorded into the same series —
    // the far jump is symmetric and one metric keeps the report readable.
    await toc.first().click();
    await waitForScrollSettled(page);
    offsets.push(await landingOffset(firstTarget));
  }
  report("jump-far-chunk", times);
  report("jump-landing-offset-px", offsets);
  for (const offset of offsets)
    expect(offset).toBeLessThanOrEqual(LANDING_TOLERANCE_PX);
});

test("scroll frame gaps", async ({ page }) => {
  await gotoBrief(page, PERF_ROUTE_REV1, {
    timeout: 90_000,
  });

  // Scripted top-to-bottom scroll inside one rAF loop: every gap between
  // consecutive frames is a sample. A long gap = a frame the main thread
  // could not produce — the jank virtualization must not add to. Instant
  // behavior per step: the CSS `scroll-behavior: smooth` would otherwise
  // animate toward each step and the page would never traverse its real
  // height inside the loop.
  const gaps = await page.evaluate(async (durationMs: number) => {
    window.scrollTo({ top: 0, behavior: "instant" });
    return new Promise<number[]>((resolve) => {
      const collected: number[] = [];
      let last: number | null = null;
      let start: number | null = null;
      const tick = (now: number) => {
        start ??= now;
        if (last !== null) collected.push(now - last);
        last = now;
        const progress = Math.min((now - start) / durationMs, 1);
        // Ceiling re-read per tick: revealing below-fold content grows the
        // real scrollHeight mid-traversal, and a stale total would stop the
        // loop short of the true bottom.
        const ceiling =
          document.documentElement.scrollHeight - window.innerHeight;
        window.scrollTo({ top: progress * ceiling, behavior: "instant" });
        if (progress >= 1) resolve(collected);
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  }, 4000);

  expect(gaps.length).toBeGreaterThan(50);
  report("scroll-p95-frame-gap", [p95(gaps)]);
  report("scroll-max-frame-gap", [Math.max(...gaps)]);
});
