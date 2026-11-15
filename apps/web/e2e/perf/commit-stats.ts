// The React render counter the commit specs share. A DevTools-hook shim
// counts, per commit, the component fibers that actually rendered (fresh
// actualStartTime) and sums the inclusive render duration of each re-render
// island. Dev-build React only: the hook relies on the dev renderer's
// profiling fields; numbers compare run-to-run, not to production.
import type { Page } from "@playwright/test";

import { report } from "./report";

export interface CommitStats {
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
 * Private React Fiber work tags for user components: FunctionComponent (0),
 * ClassComponent (1), ForwardRef (11), MemoComponent (14),
 * SimpleMemoComponent (15). Private contract, like the profiling fields the
 * hook reads: a React upgrade can silently renumber them, so every tracked
 * run ASSERTS it counted rendered components, so drift fails loudly instead of
 * reporting zeros that read as an improvement.
 */
const COMPONENT_TAGS = [0, 1, 11, 14, 15];
const HUNDREDTHS = 100;

/** Installs the counter before the page's scripts run. */
export async function installCommitHook(page: Page): Promise<void> {
  await page.addInitScript((componentTags) => {
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
            if (fresh && tags.has(node.tag)) {
              rendered += 1;
            }
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
  }, COMPONENT_TAGS);
}

/** Clears the counter and starts counting; for gestures a spec drives from outside the page. */
export async function startCommitTracking(page: Page): Promise<void> {
  await page.evaluate(() => {
    const tracked = window.__COMMIT_STATS__;
    if (!tracked) {
      throw new Error("commit hook not installed");
    }
    tracked.commits = 0;
    tracked.renderedComponents = [];
    tracked.renderMs = [];
    window.__COMMIT_TRACKING__ = true;
  });
}

export async function stopCommitTracking(page: Page): Promise<CommitStats> {
  return page.evaluate(() => {
    window.__COMMIT_TRACKING__ = false;
    const tracked = window.__COMMIT_STATS__;
    if (!tracked) {
      throw new Error("commit hook not installed");
    }
    return tracked;
  });
}

export function sumSamples(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0);
}

/** The four metrics every commit scenario reports, under its own prefix. */
export function reportCommitStats(prefix: string, stats: CommitStats): void {
  const renderMs = sumSamples(stats.renderMs);
  report(`${prefix}-commits`, [stats.commits]);
  report(`${prefix}-rendered-components-total`, [
    sumSamples(stats.renderedComponents),
  ]);
  report(`${prefix}-rendered-components-max-per-commit`, [
    Math.max(...stats.renderedComponents),
  ]);
  report(`${prefix}-render-ms-total`, [
    Math.round(renderMs * HUNDREDTHS) / HUNDREDTHS,
  ]);
}
