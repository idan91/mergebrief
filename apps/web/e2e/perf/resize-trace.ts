// Reads one Chrome trace of a resize sweep. Pure, so the numbers the fix is
// judged by have their own unit tests.

const RESIZE_MARK_PREFIX = "sweep-resize-";
export const SWEEP_START_MARK = "sweep-start";
export const IDLE_START_MARK = "sweep-idle-start";
/**
 * Calls that are never the page's work: the in-page frame probe's own rAF, and
 * the DevTools overlay's entry point, which only runs with DevTools open.
 */
const INSTRUMENTATION_FUNCTIONS = new Set([
  "sweepFrameProbe",
  "window.dispatch",
]);

export const FRAME_MS = 1000 / 60;
/** The tablet breakpoint the sidebar hands over at. */
const CROSSING_WIDTH_PX = 1120;

const MICROS_PER_MS = 1000;
/** Style and layout under this are the engine's no-op passes, not work. */
const NOISE_FLOOR_MS = 0.1;
/** Work this close to the previous work belongs to the same cycle. */
const CYCLE_GAP_FRAMES = 0.5;
const CYCLE_GAP_MS = FRAME_MS * CYCLE_GAP_FRAMES;
const TOP_FUNCTIONS = 6;
const MEDIAN_QUANTILE = 0.5;
const P95_QUANTILE = 0.95;
const TENTHS_PER_UNIT = 10;

const COST_BY_EVENT: Record<string, CostName> = {
  Layout: "layout",
  UpdateLayoutTree: "style",
  FunctionCall: "script",
  EvaluateScript: "script",
  FireAnimationFrame: "script",
  EventDispatch: "script",
  TimerFire: "script",
  RunMicrotasks: "script",
  MinorGC: "gc",
  MajorGC: "gc",
  PrePaint: "paint",
  Paint: "paint",
  Layerize: "paint",
  Commit: "paint",
  UpdateLayer: "paint",
};

const COST_NAMES = ["layout", "style", "script", "gc", "paint"] as const;

const WORK_EVENTS = new Set(["Layout", "UpdateLayoutTree", "FunctionCall"]);

export type CostName = "layout" | "style" | "script" | "gc" | "paint" | "other";

export interface TraceEvent {
  readonly name: string;
  readonly ph: string;
  readonly ts: number;
  readonly dur?: number;
  readonly pid: number;
  readonly tid: number;
  readonly args?: {
    readonly data?: { readonly functionName?: string };
    readonly beginData?: {
      readonly frame?: string;
      readonly totalObjects?: number;
    };
  };
}

export interface ResizeMark {
  readonly width: number;
  readonly at: number;
}

export interface PostResizeWork {
  /** Bursts of layout, style or script later than one frame after the last resize's task. */
  readonly cycles: number;
  readonly layoutMs: number;
  readonly styleMs: number;
  readonly scriptMs: number;
  /** When the last such burst ended, measured from the last resize. */
  readonly lastWorkAfterMs: number;
}

export interface ResizeTraceSummary {
  readonly resizeEvents: number;
  /**
   * Median layout objects in the sweep. Which diff tables sit inside the
   * content-visibility window sets it, and it alone moves the step cost about
   * twofold, so two runs compare only when it matches.
   */
  readonly layoutObjects: number;
  readonly mainThreadMs: number;
  readonly costMs: Readonly<Record<CostName, number>>;
  readonly dominantCost: CostName;
  readonly stepMedianMs: number;
  readonly stepP95Ms: number;
  readonly stepMaxMs: number;
  /** Task time delivering the first width at or under the breakpoint; 0 if none. */
  readonly crossingFrameMs: number;
  readonly crossingLongestTaskMs: number;
  readonly postResize: PostResizeWork;
  /** The same cycle count over the quiet window before the sweep: the noise floor. */
  readonly idleCycles: number;
  readonly topFunctions: readonly FunctionCost[];
}

export interface FunctionCost {
  readonly name: string;
  readonly calls: number;
  readonly totalMs: number;
}

interface TimedEvent {
  readonly event: TraceEvent;
  readonly start: number;
  readonly end: number;
  selfMs: number;
}

function readDurationMs(event: TraceEvent): number {
  return (event.dur ?? 0) / MICROS_PER_MS;
}

function roundMs(value: number): number {
  return Math.round(value * TENTHS_PER_UNIT) / TENTHS_PER_UNIT;
}

function isInstrumentationCall(event: TraceEvent): boolean {
  const name = event.args?.data?.functionName;
  return (
    event.name === "FunctionCall" &&
    name !== undefined &&
    INSTRUMENTATION_FUNCTIONS.has(name)
  );
}

/** Marks name the page's own renderer main thread; every other thread is noise. */
function selectPageThread(events: readonly TraceEvent[]): TraceEvent[] {
  const mark = events.find((event) => event.name === IDLE_START_MARK);
  if (mark === undefined) {
    throw new Error(`trace carries no ${IDLE_START_MARK} mark`);
  }
  return events.filter(
    (event) => event.pid === mark.pid && event.tid === mark.tid,
  );
}

/** Complete events in start order, each with its children's time taken off. */
function buildTimedEvents(thread: readonly TraceEvent[]): TimedEvent[] {
  const complete = thread
    .filter((event) => event.ph === "X" && event.dur !== undefined)
    .map((event) => {
      const start = event.ts / MICROS_PER_MS;
      const selfMs = readDurationMs(event);
      return { event, start, end: start + selfMs, selfMs };
    })
    .toSorted(
      (left, right) => left.start - right.start || right.end - left.end,
    );

  const open: TimedEvent[] = [];
  for (const timed of complete) {
    let parent = open.at(-1);
    while (parent !== undefined && parent.end <= timed.start) {
      open.pop();
      parent = open.at(-1);
    }
    if (parent !== undefined) {
      parent.selfMs -= timed.end - timed.start;
    }
    open.push(timed);
  }
  return complete;
}

function readMarkTime(
  thread: readonly TraceEvent[],
  name: string,
): number | undefined {
  const mark = thread.find((event) => event.name === name);
  return mark === undefined ? undefined : mark.ts / MICROS_PER_MS;
}

function readResizeMarks(thread: readonly TraceEvent[]): ResizeMark[] {
  return thread
    .filter((event) => event.name.startsWith(RESIZE_MARK_PREFIX))
    .map((event) => ({
      width: Number(event.name.slice(RESIZE_MARK_PREFIX.length)),
      at: event.ts / MICROS_PER_MS,
    }))
    .toSorted((left, right) => left.at - right.at);
}

function sumTaskMs(
  tasks: readonly TimedEvent[],
  from: number,
  to: number,
): number {
  let total = 0;
  for (const task of tasks) {
    if (task.start >= from && task.start < to) {
      total += task.end - task.start;
    }
  }
  return total;
}

/**
 * The tasks that deliver one width. Style and layout run in the tasks before
 * its mark, and the mark lands about 0.2ms inside the task that dispatches the
 * resize, so that task starts before the mark it holds.
 */
function listFrameTasks(
  tasks: readonly TimedEvent[],
  previousAt: number,
  markAt: number,
): TimedEvent[] {
  return tasks.filter(
    (task) => task.start >= previousAt && task.start <= markAt,
  );
}

function sumDurationMs(tasks: readonly TimedEvent[]): number {
  return tasks.reduce((total, task) => total + task.end - task.start, 0);
}

function readQuantile(sorted: readonly number[], quantile: number): number {
  const rank = Math.ceil(sorted.length * quantile) - 1;
  return sorted[Math.max(0, rank)] ?? 0;
}

function makeEmptyCost(): Record<CostName, number> {
  return { layout: 0, style: 0, script: 0, gc: 0, paint: 0, other: 0 };
}

function sumCostMs(
  timed: readonly TimedEvent[],
  from: number,
  to: number,
): Record<CostName, number> {
  const cost = makeEmptyCost();
  for (const entry of timed) {
    const inWindow = entry.start >= from && entry.start < to;
    if (inWindow && !isInstrumentationCall(entry.event)) {
      const name = COST_BY_EVENT[entry.event.name] ?? "other";
      cost[name] += Math.max(0, entry.selfMs);
    }
  }
  return cost;
}

/**
 * The page's own frame is the one with the most objects: with the Styles pane
 * open, DevTools' overlay lays out a frame of its own on the same thread.
 */
function readLayoutObjects(
  timed: readonly TimedEvent[],
  sweepStart: number,
): number {
  const objectsByFrame = new Map<string, number[]>();
  for (const { event, start } of timed) {
    const data = event.args?.beginData;
    const total = data?.totalObjects;
    if (event.name === "Layout" && start >= sweepStart && total !== undefined) {
      const frame = data?.frame ?? "";
      objectsByFrame.set(frame, [...(objectsByFrame.get(frame) ?? []), total]);
    }
  }

  let largest = 0;
  for (const objects of objectsByFrame.values()) {
    const sorted = objects.toSorted((left, right) => left - right);
    largest = Math.max(largest, readQuantile(sorted, MEDIAN_QUANTILE));
  }
  return largest;
}

function pickDominantCost(cost: Readonly<Record<CostName, number>>): CostName {
  let dominant: CostName = "other";
  for (const name of COST_NAMES) {
    if (cost[name] > cost[dominant]) {
      dominant = name;
    }
  }
  return dominant;
}

function isWork(entry: TimedEvent): boolean {
  if (
    !WORK_EVENTS.has(entry.event.name) ||
    isInstrumentationCall(entry.event)
  ) {
    return false;
  }
  return entry.end - entry.start >= NOISE_FLOOR_MS;
}

/**
 * Work that runs past the cutoff, merged into bursts a frame's gap apart. An
 * entry that starts before the cutoff counts when it ends after it, so a long
 * layout cannot hide by starting inside the allowance.
 */
function countCycles(
  timed: readonly TimedEvent[],
  from: number,
  to: number,
): { cycles: number; lastEnd: number } {
  let cycles = 0;
  let lastEnd = from;
  let burstEnd = Number.NEGATIVE_INFINITY;
  for (const entry of timed) {
    const inWindow = entry.end > from && entry.start < to;
    if (inWindow && isWork(entry)) {
      if (entry.start > burstEnd + CYCLE_GAP_MS) {
        cycles += 1;
      }
      burstEnd = Math.max(burstEnd, entry.end);
      lastEnd = Math.max(lastEnd, entry.end);
    }
  }
  return { cycles, lastEnd };
}

function sumTopFunctions(
  timed: readonly TimedEvent[],
  from: number,
  to: number,
): FunctionCost[] {
  const byName = new Map<string, { calls: number; totalMs: number }>();
  for (const entry of timed) {
    const inWindow = entry.start >= from && entry.start < to;
    if (inWindow && entry.event.name === "FunctionCall") {
      const name = entry.event.args?.data?.functionName || "(anonymous)";
      const held = byName.get(name) ?? { calls: 0, totalMs: 0 };
      held.calls += 1;
      held.totalMs += entry.end - entry.start;
      byName.set(name, held);
    }
  }
  return [...byName.entries()]
    .filter(([name]) => !INSTRUMENTATION_FUNCTIONS.has(name))
    .map(([name, held]) => ({
      name,
      calls: held.calls,
      totalMs: roundMs(held.totalMs),
    }))
    .toSorted((left, right) => right.totalMs - left.totalMs)
    .slice(0, TOP_FUNCTIONS);
}

/** The page's own work past the cutoff, an entry's overrun charged and no more. */
function sumLateCostMs(
  timed: readonly TimedEvent[],
  from: number,
  to: number,
): Record<CostName, number> {
  const cost = makeEmptyCost();
  for (const entry of timed) {
    const inWindow = entry.end > from && entry.start < to;
    if (inWindow && isWork(entry)) {
      const name = COST_BY_EVENT[entry.event.name] ?? "other";
      const overrunMs = entry.end - Math.max(entry.start, from);
      cost[name] += Math.max(0, Math.min(entry.selfMs, overrunMs));
    }
  }
  return cost;
}

function measurePostResize(
  timed: readonly TimedEvent[],
  tasks: readonly TimedEvent[],
  lastResize: number,
  traceEnd: number,
): PostResizeWork {
  // The task holding the last mark is that width's own frame, however long it
  // runs; the budget of one frame starts where it ends.
  const holder = tasks.findLast((task) => task.start <= lastResize);
  const cutoff = Math.max(holder?.end ?? lastResize, lastResize) + FRAME_MS;
  const { cycles, lastEnd } = countCycles(timed, cutoff, traceEnd);
  const cost = sumLateCostMs(timed, cutoff, traceEnd);
  return {
    cycles,
    layoutMs: roundMs(cost.layout),
    styleMs: roundMs(cost.style),
    scriptMs: roundMs(cost.script),
    lastWorkAfterMs: cycles === 0 ? 0 : roundMs(lastEnd - lastResize),
  };
}

function measureCrossing(
  tasks: readonly TimedEvent[],
  marks: readonly ResizeMark[],
  sweepStart: number,
): { frameMs: number; longestTaskMs: number } {
  const index = marks.findIndex((mark) => mark.width <= CROSSING_WIDTH_PX);
  const crossing = marks[index];
  if (crossing === undefined) {
    return { frameMs: 0, longestTaskMs: 0 };
  }

  const previousAt = marks[index - 1]?.at ?? sweepStart;
  let frameMs = 0;
  let longestTaskMs = 0;
  for (const task of listFrameTasks(tasks, previousAt, crossing.at)) {
    const duration = task.end - task.start;
    frameMs += duration;
    longestTaskMs = Math.max(longestTaskMs, duration);
  }
  return { frameMs, longestTaskMs };
}

export function summarizeResizeTrace(
  events: readonly TraceEvent[],
): ResizeTraceSummary {
  const thread = selectPageThread(events);
  const timed = buildTimedEvents(thread);
  const tasks = timed.filter((entry) => entry.event.name === "RunTask");
  const marks = readResizeMarks(thread);
  const idleStart = readMarkTime(thread, IDLE_START_MARK) ?? 0;
  const sweepStart = readMarkTime(thread, SWEEP_START_MARK) ?? idleStart;
  const lastResize = marks.at(-1)?.at ?? sweepStart;
  const traceEnd = timed.reduce(
    (latest, entry) => Math.max(latest, entry.end),
    sweepStart,
  );

  const steps = marks.map((mark, index) => {
    const previousAt = marks[index - 1]?.at ?? sweepStart;
    return sumDurationMs(listFrameTasks(tasks, previousAt, mark.at));
  });
  const sortedSteps = steps.toSorted((left, right) => left - right);
  const cost = sumCostMs(timed, sweepStart, traceEnd);
  const roundedCost: Record<CostName, number> = {
    layout: roundMs(cost.layout),
    style: roundMs(cost.style),
    script: roundMs(cost.script),
    gc: roundMs(cost.gc),
    paint: roundMs(cost.paint),
    other: roundMs(cost.other),
  };
  const crossing = measureCrossing(tasks, marks, sweepStart);

  return {
    resizeEvents: marks.length,
    layoutObjects: readLayoutObjects(timed, sweepStart),
    mainThreadMs: roundMs(sumTaskMs(tasks, sweepStart, traceEnd)),
    costMs: roundedCost,
    dominantCost: pickDominantCost(cost),
    stepMedianMs: roundMs(readQuantile(sortedSteps, MEDIAN_QUANTILE)),
    stepP95Ms: roundMs(readQuantile(sortedSteps, P95_QUANTILE)),
    stepMaxMs: roundMs(sortedSteps.at(-1) ?? 0),
    crossingFrameMs: roundMs(crossing.frameMs),
    crossingLongestTaskMs: roundMs(crossing.longestTaskMs),
    postResize: measurePostResize(timed, tasks, lastResize, traceEnd),
    idleCycles: countCycles(timed, idleStart, sweepStart).cycles,
    topFunctions: sumTopFunctions(timed, sweepStart, traceEnd),
  };
}
