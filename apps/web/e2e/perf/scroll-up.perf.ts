// Scrolling up after a reload mid-brief, on the generated large fixture: the
// cards above the viewport were never measured, so each one settles as the
// reader meets it. Content must follow the wheel exactly, frame by frame.
import { expect, test, type Page } from "@playwright/test";

import { CHUNK_WINDOW_INDEX_ATTR } from "../../src/features/brief/ui/components/BriefView/reading/useGroupWindow";
import { STORY_CHUNKS_ATTR } from "../../src/features/brief/ui/components/BriefView/StoryView/StorySplitter/consts";
import { gotoBrief, waitForInteractive } from "../support/page";
import { PERF_ROUTE_REV1 } from "./ids";

// Precise deltas, as a trackpad sends them: Chromium's animated wheel would
// interpolate every frame and hide a jump inside the easing.
test.use({ launchOptions: { args: ["--disable-smooth-scrolling"] } });

const DESKTOP_VIEWPORT = { width: 1440, height: 900 } as const;
/** Deep enough that a few hundred cards above were never measured. */
const RELOAD_DEPTH = 0.55;
const WHEEL_STEP_PX = 40;
const WHEEL_TICKS = 160;
const TICK_GAP_MS = 16;
const SETTLE_MS = 2000;
/** Sub-pixel layout rounding, never a visible move. */
const TOLERANCE_PX = 2;
/** Scroll restoration lands near, not at, the depth left; the top would test nothing. */
const MIN_RESTORED_DEPTH = 0.4;
/** Frames where the probe re-picks its anchor go unlogged, so the sum runs a little short. */
const MIN_LOGGED_TRAVEL = 0.85;
const CARD_SLOT_SELECTOR = `[${STORY_CHUNKS_ATTR}] > [${CHUNK_WINDOW_INDEX_ATTR}]`;

interface FrameMotion {
  /** Frames whose move is not a whole number of wheel steps. */
  jumps: number[];
  /** Frames where content moved up while the page scrolled up. */
  snapBacks: number[];
  /** How far the content moved in all, in px. */
  travel: number;
}

async function startFrameLog(page: Page): Promise<void> {
  await page.evaluate(() => {
    const log = { motions: [] as number[], anchor: null as Element | null };
    let top = 0;
    const pick = () => {
      log.anchor = document.elementFromPoint(
        window.innerWidth / 2,
        window.innerHeight / 2,
      );
      top = log.anchor?.getBoundingClientRect().top ?? 0;
    };
    const tick = () => {
      if (log.anchor?.isConnected === true) {
        const next = log.anchor.getBoundingClientRect().top;
        log.motions.push(next - top);
        top = next;
        const nearEdge = next < 100 || next > window.innerHeight - 100;
        if (nearEdge) {
          pick();
        }
      } else {
        pick();
      }
      requestAnimationFrame(tick);
    };
    pick();
    requestAnimationFrame(tick);
    Object.assign(window, { scrollUpLog: log });
  });
}

async function readFrameMotion(page: Page): Promise<FrameMotion> {
  const motions = await page.evaluate(
    () =>
      (window as unknown as { scrollUpLog: { motions: number[] } }).scrollUpLog
        .motions,
  );
  const measureOffStep = (move: number) =>
    Math.abs(move - WHEEL_STEP_PX * Math.round(move / WHEEL_STEP_PX));
  return {
    jumps: motions.filter((move) => measureOffStep(move) > TOLERANCE_PX),
    snapBacks: motions.filter((move) => move < -TOLERANCE_PX),
    travel: motions.reduce((total, move) => total + move, 0),
  };
}

interface SlotSpacing {
  /** Adjacent card slots measured. */
  pairs: number;
  /** Where the next card sits other than right after a slot, in px. */
  gaps: number[];
}

async function readSlotSpacing(page: Page): Promise<SlotSpacing> {
  return page.evaluate(
    ({ selector, indexAttribute }) => {
      const pairs = [...document.querySelectorAll<HTMLElement>(selector)]
        .map((slot) => ({ slot, next: slot.nextElementSibling }))
        .filter(
          (pair): pair is { slot: HTMLElement; next: HTMLElement } =>
            pair.next instanceof HTMLElement &&
            pair.next.hasAttribute(indexAttribute),
        );
      const gaps = pairs
        .map(
          ({ slot, next }) =>
            next.offsetTop - slot.offsetTop - slot.offsetHeight,
        )
        .filter((gap) => gap !== 0);
      return { pairs: pairs.length, gaps };
    },
    { selector: CARD_SLOT_SELECTOR, indexAttribute: CHUNK_WINDOW_INDEX_ATTR },
  );
}

test("scrolling up after a reload mid-brief follows the wheel exactly", async ({
  page,
}) => {
  await page.setViewportSize(DESKTOP_VIEWPORT);
  await gotoBrief(page, PERF_ROUTE_REV1);
  await page.evaluate((depth) => {
    const top = document.documentElement.scrollHeight * depth;
    window.scrollTo({ top, behavior: "instant" });
  }, RELOAD_DEPTH);
  await page.reload();
  await waitForInteractive(page);
  await page.waitForTimeout(SETTLE_MS);
  const restoredDepth = await page.evaluate(
    () => window.scrollY / document.documentElement.scrollHeight,
  );
  expect(restoredDepth).toBeGreaterThan(MIN_RESTORED_DEPTH);

  const viewport = page.viewportSize() ?? DESKTOP_VIEWPORT;
  await page.mouse.move(viewport.width / 2, viewport.height / 2);
  await startFrameLog(page);
  for (let tick = 0; tick < WHEEL_TICKS; tick += 1) {
    await page.mouse.wheel(0, -WHEEL_STEP_PX);
    await page.waitForTimeout(TICK_GAP_MS);
  }
  const { jumps, snapBacks, travel } = await readFrameMotion(page);

  expect({ jumps, snapBacks }).toEqual({ jumps: [], snapBacks: [] });
  expect(travel).toBeGreaterThan(
    WHEEL_TICKS * WHEEL_STEP_PX * MIN_LOGGED_TRAVEL,
  );
  const spacing = await readSlotSpacing(page);
  expect(spacing.pairs).toBeGreaterThan(0);
  expect(spacing.gaps).toEqual([]);
});
