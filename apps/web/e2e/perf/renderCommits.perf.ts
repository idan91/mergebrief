// React render work under scroll, counted by the shared commit hook:
//   storm-*: full-page traversal, windowed card mounts included
//   spy-tick-*: boundary wiggles in a warmed region, reading-position ticks only
import { expect, test } from "@playwright/test";

import { gotoBrief } from "../support/page";
import {
  installCommitHook,
  reportCommitStats,
  sumSamples,
} from "./commit-stats";
import { PERF_ROUTE_REV1 } from "./ids";

test.beforeEach(async ({ page }) => {
  await installCommitHook(page);
});

test("render work during a scroll storm", async ({ page }) => {
  await gotoBrief(page, PERF_ROUTE_REV1, {
    timeout: 90_000,
  });

  const stats = await page.evaluate(async (durationMs: number) => {
    window.scrollTo({ top: 0, behavior: "instant" });
    await new Promise((resolve) => {
      setTimeout(resolve, 300);
    });
    const tracked = window.__COMMIT_STATS__;
    if (!tracked) {
      throw new Error("commit hook not installed");
    }
    tracked.commits = 0;
    tracked.renderedComponents = [];
    tracked.renderMs = [];
    window.__COMMIT_TRACKING__ = true;
    await new Promise<void>((resolve) => {
      let start: number | null = null;
      const tick = (now: number) => {
        start ??= now;
        const progress = Math.min((now - start) / durationMs, 1);
        const ceiling =
          document.documentElement.scrollHeight - window.innerHeight;
        window.scrollTo({ top: progress * ceiling, behavior: "instant" });
        if (progress >= 1) {
          resolve();
        } else {
          requestAnimationFrame(tick);
        }
      };
      requestAnimationFrame(tick);
    });
    window.__COMMIT_TRACKING__ = false;
    return tracked;
  }, 4000);

  expect(stats.commits).toBeGreaterThan(0);
  // The fiber-contract canary: commits with zero counted component renders
  // means the private tags/profiling fields drifted, not that the app got
  // infinitely cheaper.
  expect(sumSamples(stats.renderedComponents)).toBeGreaterThan(0);
  expect(sumSamples(stats.renderMs)).toBeGreaterThan(0);
  reportCommitStats("storm", stats);
});

test("render work per pure scroll-spy tick", async ({ page }) => {
  await gotoBrief(page, PERF_ROUTE_REV1, {
    timeout: 90_000,
  });

  // Warm a region first (cards mounted, sizes measured), then wiggle across
  // chunk boundaries inside it: every commit left is a scroll-spy tick, not
  // a windowing mount.
  const stats = await page.evaluate(async () => {
    const settle = () =>
      new Promise((resolve) => {
        setTimeout(resolve, 250);
      });
    window.scrollTo({ top: 2000, behavior: "instant" });
    await settle();
    window.scrollTo({ top: 3000, behavior: "instant" });
    await settle();
    window.scrollTo({ top: 2000, behavior: "instant" });
    await settle();

    // A card boundary inside the warmed region: the reading line (150px)
    // crosses it on a ±80px wiggle, flipping the spy's answer, while the
    // virtualizer's rendered range stays put (card heights >> 160px).
    const cards = [
      ...document.querySelectorAll<HTMLElement>('[data-testid="brief-chunk"]'),
    ];
    const boundary = cards
      .map((card) => card.getBoundingClientRect().top + window.scrollY)
      .find((top) => top - window.scrollY > 600);
    if (boundary === undefined) {
      throw new Error("no card boundary in view");
    }
    const readingLineOffset = 150;
    const low = boundary - readingLineOffset - 80;
    const high = boundary - readingLineOffset + 80;

    const tracked = window.__COMMIT_STATS__;
    if (!tracked) {
      throw new Error("commit hook not installed");
    }
    tracked.commits = 0;
    tracked.renderedComponents = [];
    tracked.renderMs = [];
    window.__COMMIT_TRACKING__ = true;
    for (let i = 0; i < 30; i += 1) {
      window.scrollTo({
        top: i % 2 === 0 ? high : low,
        behavior: "instant",
      });
      await new Promise((resolve) => {
        setTimeout(resolve, 120);
      });
    }
    window.__COMMIT_TRACKING__ = false;
    return tracked;
  });

  expect(stats.commits).toBeGreaterThan(0);
  // Same fiber-contract canary as the storm test.
  expect(sumSamples(stats.renderedComponents)).toBeGreaterThan(0);
  reportCommitStats("spy-tick", stats);
});
