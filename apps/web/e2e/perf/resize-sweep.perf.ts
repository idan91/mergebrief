// Drags the brief page's window from 1300px to 700px under a Chrome trace and
// reports per scenario the dominant cost, the work after the drag stops, the
// step cost, the breakpoint frame and the content shift a reader would see.
// "paced" sends one width per rendered frame; "burst" sends on the clock, so
// widths the page cannot keep up with queue and replay after the pointer stops.
//   pnpm perf:fixture --groups 40 --chunks-per-group 10 --line-scale 10
//   pnpm perf:measure e2e/perf/resize-sweep.perf.ts
// Knobs: MERGEBRIEF_SWEEP_{LABEL,OUT_DIR,RUNS,MODES,THROTTLES,PACINGS,STEP_PX,INTERVAL_MS,KEEP_TRACE,DEVTOOLS}.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  chromium,
  expect,
  test,
  type Browser,
  type BrowserContextOptions,
  type CDPSession,
  type Page,
} from "@playwright/test";

import { gotoBrief } from "../support/page";
import { PERF_ROUTE_REV1 } from "./ids";
import { report } from "./report";
import {
  FRAME_MS,
  IDLE_START_MARK,
  summarizeResizeTrace,
  SWEEP_START_MARK,
  type ResizeTraceSummary,
  type TraceEvent,
} from "./resize-trace";

const SWEEP_START_WIDTH_PX = 1300;
const SWEEP_END_WIDTH_PX = 700;
const WINDOW_HEIGHT_PX = 1000;
const DEVTOOLS_DOCK_PX = 555;
const IDLE_WINDOW_MS = 1000;
const OBSERVE_WINDOW_MS = 2500;
const SETTLE_WINDOW_MS = 1500;
const WIDTH_POLL_MS = 50;
const SCENARIO_TIMEOUT_MS = 600_000;
const FIRST_LOAD_TIMEOUT_MS = 120_000;
const TOKENS_TIMEOUT_MS = 90_000;
const MID_PAGE_FRACTION = 0.5;
const UNTHROTTLED_RATE = 1;
const VISIBLE_MOVE_PX = 0.5;
const TRACE_CATEGORIES = [
  "devtools.timeline",
  "disabled-by-default-devtools.timeline",
  "blink.user_timing",
  "toplevel",
];

const MID_PAGE_MODE = "mid-page";
const READ_THROUGH_MODE = "read-through";
const SWEEP_MODES = ["top", MID_PAGE_MODE, READ_THROUGH_MODE];
const PACED_PACING = "paced";
const SWEEP_PACINGS = [PACED_PACING, "burst"];
const DEFAULT_THROTTLES = ["1", "4"];
const DEFAULT_RUNS = 3;
const DEFAULT_STEP_PX = 10;
const DEFAULT_INTERVAL_MS = 16;

interface SweepOptions {
  label: string;
  outDir: string;
  runs: number;
  modes: readonly string[];
  throttles: readonly number[];
  pacings: readonly string[];
  stepPx: number;
  intervalMs: number;
  keepTrace: boolean;
  /** Opens a real DevTools frontend, docked, on Elements with the Styles pane. */
  devtools: boolean;
}

/** What a reader would have seen, read in the page once a frame. */
interface FrameShift {
  /** Frames later than one frame after the drag stopped where a visible card moved. */
  frames: number;
  /** Largest single-frame move of a visible card among those frames. */
  maxMovePx: number;
  /** When the last such frame ran, measured from the drag's stop. */
  lastAfterStopMs: number;
}

interface SweepRun extends ResizeTraceSummary {
  /** How long after the drag stopped the page delivered its last resize. */
  drainMs: number;
  shift: FrameShift;
  domNodes: number;
}

interface FrameSample {
  at: number;
  movePx: number;
}

interface ProbeState {
  lastResizeAt: number;
  samples: FrameSample[];
}

interface PageReadout extends ProbeState {
  domNodes: number;
  timeOrigin: number;
}

interface WindowDriver {
  client: CDPSession;
  windowId: number;
  frameWidthPx: number;
}

function readList(raw: string | undefined, fallback: readonly string[]) {
  return raw === undefined ? fallback : raw.split(",");
}

function readSweepOptions(): SweepOptions {
  const env = process.env;
  const defaultOutDir = fileURLToPath(
    new URL("../.artifacts/resize-sweep", import.meta.url),
  );
  const throttles = readList(
    env["MERGEBRIEF_SWEEP_THROTTLES"],
    DEFAULT_THROTTLES,
  );
  return {
    label: env["MERGEBRIEF_SWEEP_LABEL"] ?? "run",
    outDir: env["MERGEBRIEF_SWEEP_OUT_DIR"] ?? defaultOutDir,
    runs: Number(env["MERGEBRIEF_SWEEP_RUNS"] ?? DEFAULT_RUNS),
    modes: readList(env["MERGEBRIEF_SWEEP_MODES"], SWEEP_MODES),
    throttles: throttles.map(Number),
    pacings: readList(env["MERGEBRIEF_SWEEP_PACINGS"], SWEEP_PACINGS),
    stepPx: Number(env["MERGEBRIEF_SWEEP_STEP_PX"] ?? DEFAULT_STEP_PX),
    intervalMs: Number(
      env["MERGEBRIEF_SWEEP_INTERVAL_MS"] ?? DEFAULT_INTERVAL_MS,
    ),
    keepTrace: env["MERGEBRIEF_SWEEP_KEEP_TRACE"] === "1",
    devtools: env["MERGEBRIEF_SWEEP_DEVTOOLS"] === "1",
  };
}

const options = readSweepOptions();

/** Runs in the page: marks each resize and samples visible cards once a frame. */
function installFrameProbe(): void {
  const state: ProbeState = { lastResizeAt: 0, samples: [] };
  let tops = new Map<Element, number>();

  window.addEventListener("resize", () => {
    state.lastResizeAt = performance.now();
    performance.mark(`sweep-resize-${String(window.innerWidth)}`);
  });

  function sweepFrameProbe(): void {
    const nextTops = new Map<Element, number>();
    let movePx = 0;
    const cards = document.querySelectorAll('[data-testid="brief-chunk"]');
    for (const card of cards) {
      const rect = card.getBoundingClientRect();
      if (rect.bottom > 0 && rect.top < window.innerHeight) {
        nextTops.set(card, rect.top);
        const priorTop = tops.get(card);
        if (priorTop !== undefined) {
          movePx = Math.max(movePx, Math.abs(rect.top - priorTop));
        }
      }
    }
    tops = nextTops;
    state.samples.push({ at: performance.now(), movePx });
    requestAnimationFrame(sweepFrameProbe);
  }

  requestAnimationFrame(sweepFrameProbe);
  Object.assign(window, { sweepProbeState: state });
}

function readPageReadout(page: Page): Promise<PageReadout> {
  return page.evaluate(() => {
    const { sweepProbeState } = window as unknown as {
      sweepProbeState: ProbeState;
    };
    return {
      ...sweepProbeState,
      domNodes: document.getElementsByTagName("*").length,
      timeOrigin: performance.timeOrigin,
    };
  });
}

function clearSamples(page: Page): Promise<void> {
  return page.evaluate(() => {
    const { sweepProbeState } = window as unknown as {
      sweepProbeState: ProbeState;
    };
    sweepProbeState.samples = [];
  });
}

function measureFrameShift(
  samples: readonly FrameSample[],
  stoppedAt: number,
): FrameShift {
  const shift: FrameShift = { frames: 0, maxMovePx: 0, lastAfterStopMs: 0 };
  const cutoff = stoppedAt + FRAME_MS;
  for (const sample of samples) {
    if (sample.at > cutoff && sample.movePx >= VISIBLE_MOVE_PX) {
      shift.frames += 1;
      shift.maxMovePx = Math.max(shift.maxMovePx, Math.round(sample.movePx));
      shift.lastAfterStopMs = Math.round(sample.at - stoppedAt);
    }
  }
  return shift;
}

function setWindowWidth(driver: WindowDriver, width: number): Promise<unknown> {
  return driver.client.send("Browser.setWindowBounds", {
    windowId: driver.windowId,
    bounds: { width: width + driver.frameWidthPx, height: WINDOW_HEIGHT_PX },
  });
}

/** Widths the page falls behind on keep arriving long after the drag stopped. */
function waitForWidth(page: Page, width: number): Promise<unknown> {
  return page.waitForFunction(
    (expected) => window.innerWidth === expected,
    width,
    { polling: WIDTH_POLL_MS },
  );
}

function waitForFrame(page: Page): Promise<unknown> {
  return page.evaluate(() => new Promise(requestAnimationFrame));
}

function readLastWidth(): number {
  const travelPx = SWEEP_START_WIDTH_PX - SWEEP_END_WIDTH_PX;
  const steps = Math.floor(travelPx / options.stepPx);
  return SWEEP_START_WIDTH_PX - steps * options.stepPx;
}

/** Drags the edge and returns when, on the epoch clock, the drag stopped. */
async function dragWindow(
  page: Page,
  driver: WindowDriver,
  pacing: string,
): Promise<number> {
  const sends: Promise<unknown>[] = [];
  let stoppedAt = Date.now();
  for (
    let width = SWEEP_START_WIDTH_PX - options.stepPx;
    width >= SWEEP_END_WIDTH_PX;
    width -= options.stepPx
  ) {
    const sent = setWindowWidth(driver, width);
    sends.push(sent);
    if (pacing === PACED_PACING) {
      await sent;
      await waitForFrame(page);
      stoppedAt = Date.now();
    } else {
      stoppedAt = Date.now();
      await page.waitForTimeout(options.intervalMs);
    }
  }
  await Promise.all(sends);
  return stoppedAt;
}

async function prepareMode(page: Page, mode: string): Promise<void> {
  if (mode === MID_PAGE_MODE) {
    await page.evaluate((fraction) => {
      const top = document.documentElement.scrollHeight * fraction;
      window.scrollTo({ top, behavior: "instant" });
    }, MID_PAGE_FRACTION);
  }
  if (mode === READ_THROUGH_MODE) {
    await page
      .getByTestId("reading-toolbar")
      .getByRole("button", { name: /read-through/i })
      .click();
    await expect(page.getByTestId("focus-indicator")).toBeVisible();
  }
  await expect(page.locator('tbody[data-tokens="pending"]')).toHaveCount(0, {
    timeout: TOKENS_TIMEOUT_MS,
  });
  await page.waitForTimeout(SETTLE_WINDOW_MS);
}

/**
 * The real window, not the emulated viewport, in the full browser's new
 * headless mode: the page takes the same resize path a reader's drag does.
 * Its own browser, so the window size comes from here and not the project.
 */
function launchSweepBrowser(): Promise<Browser> {
  const dockPx = options.devtools ? DEVTOOLS_DOCK_PX : 0;
  const windowWidth = String(SWEEP_START_WIDTH_PX + dockPx);
  const args = [`--window-size=${windowWidth},${String(WINDOW_HEIGHT_PX)}`];
  if (options.devtools) {
    args.push("--auto-open-devtools-for-tabs");
  }
  return chromium.launch({ channel: "chromium", args });
}

async function openWindowDriver(page: Page): Promise<WindowDriver> {
  const client = await page.context().newCDPSession(page);
  const { windowId } = await client.send("Browser.getWindowForTarget");
  const frameWidthPx = await page.evaluate(
    () => window.outerWidth - window.innerWidth,
  );
  return { client, windowId, frameWidthPx };
}

async function traceOneDrag(
  browser: Browser,
  page: Page,
  driver: WindowDriver,
  pacing: string,
): Promise<{ trace: Buffer; stoppedAt: number }> {
  await browser.startTracing(page, { categories: TRACE_CATEGORIES });
  await page.evaluate((name) => performance.mark(name), IDLE_START_MARK);
  await page.waitForTimeout(IDLE_WINDOW_MS);
  await page.evaluate((name) => performance.mark(name), SWEEP_START_MARK);
  const stoppedAt = await dragWindow(page, driver, pacing);
  await waitForWidth(page, readLastWidth());
  await page.waitForTimeout(OBSERVE_WINDOW_MS);
  return { trace: await browser.stopTracing(), stoppedAt };
}

function parseTrace(buffer: Buffer): TraceEvent[] {
  const parsed = JSON.parse(buffer.toString()) as { traceEvents: TraceEvent[] };
  return parsed.traceEvents;
}

function readMedian(values: readonly number[]): number {
  const sorted = values.toSorted((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

function summarizeScenario(
  scenario: string,
  runs: readonly SweepRun[],
): Record<string, number | string> {
  const readRunMedian = (read: (run: SweepRun) => number) =>
    readMedian(runs.map(read));
  const row = {
    scenario,
    domNodes: readRunMedian((run) => run.domNodes),
    dominantCost: runs[0]?.dominantCost ?? "other",
    layoutObjects: readRunMedian((run) => run.layoutObjects),
    resizeEvents: readRunMedian((run) => run.resizeEvents),
    stepMedianMs: readRunMedian((run) => run.stepMedianMs),
    stepP95Ms: readRunMedian((run) => run.stepP95Ms),
    crossingFrameMs: readRunMedian((run) => run.crossingFrameMs),
    crossingLongestTaskMs: readRunMedian((run) => run.crossingLongestTaskMs),
    postResizeCycles: readRunMedian((run) => run.postResize.cycles),
    idleCycles: readRunMedian((run) => run.idleCycles),
    lastWorkAfterMs: readRunMedian((run) => run.postResize.lastWorkAfterMs),
    drainMs: readRunMedian((run) => run.drainMs),
    shiftFrames: readRunMedian((run) => run.shift.frames),
    shiftLastAfterStopMs: readRunMedian((run) => run.shift.lastAfterStopMs),
    shiftMaxMovePx: readRunMedian((run) => run.shift.maxMovePx),
  };
  report(
    `resize-sweep-${scenario}-step-ms`,
    runs.map((run) => run.stepMedianMs),
  );
  report(
    `resize-sweep-${scenario}-drain-ms`,
    runs.map((run) => run.drainMs),
  );
  return row;
}

async function measureOneDrag(
  browser: Browser,
  page: Page,
  driver: WindowDriver,
  pacing: string,
): Promise<{ run: SweepRun; trace: Buffer }> {
  await setWindowWidth(driver, SWEEP_START_WIDTH_PX);
  await waitForWidth(page, SWEEP_START_WIDTH_PX);
  await page.waitForTimeout(SETTLE_WINDOW_MS);
  await clearSamples(page);

  const { trace, stoppedAt } = await traceOneDrag(
    browser,
    page,
    driver,
    pacing,
  );
  const readout = await readPageReadout(page);
  const stoppedInPage = stoppedAt - readout.timeOrigin;
  const run: SweepRun = {
    ...summarizeResizeTrace(parseTrace(trace)),
    drainMs: Math.max(0, Math.round(readout.lastResizeAt - stoppedInPage)),
    shift: measureFrameShift(readout.samples, stoppedInPage),
    domNodes: readout.domNodes,
  };
  return { run, trace };
}

for (const mode of options.modes) {
  for (const throttle of options.throttles) {
    for (const pacing of options.pacings) {
      const scenario = `${mode}-${String(throttle)}x-${pacing}`;

      test(`resize sweep ${scenario}`, async ({ baseURL, storageState }) => {
        test.setTimeout(SCENARIO_TIMEOUT_MS);
        mkdirSync(options.outDir, { recursive: true });
        const outPath = join(options.outDir, `${options.label}-${scenario}`);

        const browser = await launchSweepBrowser();
        // Playwright merges the project's device profile into every context,
        // and that profile's scale factor refuses a null viewport.
        const context = await browser.newContext({
          viewport: null,
          deviceScaleFactor: undefined,
          baseURL,
          storageState,
        } as unknown as BrowserContextOptions);
        const page = await context.newPage();
        await gotoBrief(page, `${PERF_ROUTE_REV1}&diff=split`, {
          timeout: FIRST_LOAD_TIMEOUT_MS,
        });
        await prepareMode(page, mode);
        await page.evaluate(installFrameProbe);
        const driver = await openWindowDriver(page);
        await driver.client.send("Emulation.setCPUThrottlingRate", {
          rate: throttle,
        });

        // Untraced: the first drag pays for JIT and first-measure work no
        // later drag repeats, and would make the runs incomparable.
        await dragWindow(page, driver, pacing);
        await waitForWidth(page, readLastWidth());
        await page.waitForTimeout(SETTLE_WINDOW_MS);

        const runs: SweepRun[] = [];
        for (let index = 0; index < options.runs; index += 1) {
          const { run, trace } = await measureOneDrag(
            browser,
            page,
            driver,
            pacing,
          );
          runs.push(run);
          console.log(`SWEEP_RUN ${scenario} ${JSON.stringify(run)}`);
          if (options.keepTrace && index === 0) {
            writeFileSync(`${outPath}.trace.json`, trace);
          }
        }

        await driver.client.send("Emulation.setCPUThrottlingRate", {
          rate: UNTHROTTLED_RATE,
        });
        const row = summarizeScenario(scenario, runs);
        console.log(`SWEEP_MEDIAN ${JSON.stringify(row)}`);
        writeFileSync(
          `${outPath}.json`,
          JSON.stringify({ median: row, runs }, null, 2),
        );
        await browser.close();
      });
    }
  }
}
