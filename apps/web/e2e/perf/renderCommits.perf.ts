// React render work under scroll:
//   storm-*    — full-page traversal (windowed card mounts included)
//   spy-tick-* — boundary wiggles in a warmed region: pure reading-position
//                ticks, no windowing mounts
// A DevTools-hook shim counts, per commit, the component fibers that
// actually rendered (fresh actualStartTime) and sums the inclusive render
// duration of each re-render island. Dev-build React only — the hook relies
// on the dev renderer's profiling fields; numbers compare run-to-run, not
// to production.
import { expect, test } from "@playwright/test";

import { gotoBrief } from "../support/page";
import { PERF_ROUTE_REV1 } from "./ids";
import { report } from "./report";

interface CommitStats {
  commits: number;
  renderedComponents: number[];
  renderMs: number[];
}

declare global {
  interface Window {
    __COMMIT_TRACKING__?: boolean;
    __COMMIT_STATS__?: CommitStats;
  }
}

/**
 * Private React Fiber work tags for user components — FunctionComponent (0),
 * ClassComponent (1), ForwardRef (11), MemoComponent (14),
 * SimpleMemoComponent (15). Private contract, like the profiling fields the
 * hook reads: a React upgrade can silently renumber them, so every tracked
 * run ASSERTS it counted rendered components — drift fails loudly instead of
 * reporting zeros that read as an improvement.
 */
const COMPONENT_TAGS = new Set([0, 1, 11, 14, 15]);

test.beforeEach(async ({ page }) => {
  await page.addInitScript(
    ([componentTags]) => {
      const stats: CommitStats = {
        commits: 0,
        renderedComponents: [],
        renderMs: [],
      };
      window.__COMMIT_STATS__ = stats;
      let lastCommitTime = 0;
      const tags = new Set(componentTags);

      interface FiberLike {
        tag: number;
        actualStartTime?: number;
        actualDuration?: number;
        child: FiberLike | null;
        sibling: FiberLike | null;
      }

      const hook = {
        renderers: new Map<number, unknown>(),
        supportsFiber: true,
        inject(renderer: unknown) {
          const id = hook.renderers.size + 1;
          hook.renderers.set(id, renderer);
          return id;
        },
        onScheduleFiberRoot() {},
        onCommitFiberUnmount() {},
        onCommitFiberRoot(_id: number, root: { current: FiberLike }) {
          const now = performance.now();
          if (window.__COMMIT_TRACKING__ !== true) {
            lastCommitTime = now;
            return;
          }
          let rendered = 0;
          let islandMs = 0;
          const walk = (fiber: FiberLike | null, insideIsland: boolean) => {
            for (let node = fiber; node !== null; node = node.sibling) {
              const fresh =
                typeof node.actualStartTime === "number" &&
                node.actualStartTime > lastCommitTime;
              if (fresh && tags.has(node.tag)) rendered += 1;
              if (fresh && !insideIsland) {
                islandMs += node.actualDuration ?? 0;
                walk(node.child, true);
              } else {
                walk(node.child, insideIsland || fresh);
              }
            }
          };
          walk(root.current, false);
          stats.commits += 1;
          stats.renderedComponents.push(rendered);
          stats.renderMs.push(islandMs);
          lastCommitTime = now;
        },
      };
      Object.defineProperty(window, "__REACT_DEVTOOLS_GLOBAL_HOOK__", {
        value: hook,
        configurable: false,
        writable: false,
      });
    },
    [[...COMPONENT_TAGS]] as const,
  );
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
    const stats = window.__COMMIT_STATS__;
    if (!stats) throw new Error("commit hook not installed");
    stats.commits = 0;
    stats.renderedComponents = [];
    stats.renderMs = [];
    window.__COMMIT_TRACKING__ = true;
    await new Promise<void>((resolve) => {
      let start: number | null = null;
      const tick = (now: number) => {
        start ??= now;
        const progress = Math.min((now - start) / durationMs, 1);
        const ceiling =
          document.documentElement.scrollHeight - window.innerHeight;
        window.scrollTo({ top: progress * ceiling, behavior: "instant" });
        if (progress >= 1) resolve();
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    window.__COMMIT_TRACKING__ = false;
    return stats;
  }, 4000);

  expect(stats.commits).toBeGreaterThan(0);
  const total = (values: number[]) =>
    values.reduce((sum, value) => sum + value, 0);
  // The fiber-contract canary: commits with zero counted component renders
  // means the private tags/profiling fields drifted, not that the app got
  // infinitely cheaper.
  expect(total(stats.renderedComponents)).toBeGreaterThan(0);
  expect(total(stats.renderMs)).toBeGreaterThan(0);
  report("storm-commits", [stats.commits]);
  report("storm-rendered-components-total", [total(stats.renderedComponents)]);
  report("storm-rendered-components-max-per-commit", [
    Math.max(...stats.renderedComponents),
  ]);
  report("storm-render-ms-total", [
    Math.round(total(stats.renderMs) * 100) / 100,
  ]);
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
      ...document.querySelectorAll<HTMLElement>(".group-chunks article[id]"),
    ];
    const boundary = cards
      .map((card) => card.getBoundingClientRect().top + window.scrollY)
      .find((top) => top - window.scrollY > 600);
    if (boundary === undefined) throw new Error("no card boundary in view");
    const readingLineOffset = 150;
    const low = boundary - readingLineOffset - 80;
    const high = boundary - readingLineOffset + 80;

    const stats = window.__COMMIT_STATS__;
    if (!stats) throw new Error("commit hook not installed");
    stats.commits = 0;
    stats.renderedComponents = [];
    stats.renderMs = [];
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
    return stats;
  });

  expect(stats.commits).toBeGreaterThan(0);
  const total = (values: number[]) =>
    values.reduce((sum, value) => sum + value, 0);
  // Same fiber-contract canary as the storm test.
  expect(total(stats.renderedComponents)).toBeGreaterThan(0);
  report("spy-tick-commits", [stats.commits]);
  report("spy-tick-rendered-components-total", [
    total(stats.renderedComponents),
  ]);
  report("spy-tick-rendered-components-max-per-commit", [
    Math.max(...stats.renderedComponents),
  ]);
  report("spy-tick-render-ms-total", [
    Math.round(total(stats.renderMs) * 100) / 100,
  ]);
});
