import { describe, expect, it } from "vitest";

import {
  IDLE_START_MARK,
  summarizeResizeTrace,
  SWEEP_START_MARK,
  type TraceEvent,
} from "./resize-trace";

const RESIZE_MARK_PREFIX = "sweep-resize-";
const FRAME_PROBE_FUNCTION = "sweepFrameProbe";
const PAGE_PID = 7;
const PAGE_TID = 9;
const MICROS_PER_MS = 1000;

function makeMark(name: string, atMs: number): TraceEvent {
  return {
    name,
    ph: "R",
    ts: atMs * MICROS_PER_MS,
    pid: PAGE_PID,
    tid: PAGE_TID,
  };
}

function makeEvent(
  name: string,
  atMs: number,
  durationMs: number,
  functionName?: string,
): TraceEvent {
  const event: TraceEvent = {
    name,
    ph: "X",
    ts: atMs * MICROS_PER_MS,
    dur: durationMs * MICROS_PER_MS,
    pid: PAGE_PID,
    tid: PAGE_TID,
  };
  if (functionName === undefined) {
    return event;
  }
  return { ...event, args: { data: { functionName } } };
}

/**
 * Two widths in the order a trace records them: a task with the width's style
 * and layout, then the task that dispatches the resize, with the mark about
 * 0.2ms inside it. A later task belongs to the next frame.
 */
function makeSweepEvents(): TraceEvent[] {
  return [
    makeMark(IDLE_START_MARK, 0),
    makeMark(SWEEP_START_MARK, 900),
    makeEvent("RunTask", 970, 12),
    makeEvent("Layout", 971, 8),
    makeEvent("RunTask", 999.8, 10),
    makeMark(`${RESIZE_MARK_PREFIX}1130`, 1000),
    makeEvent("RunTask", 1090, 30),
    makeEvent("Layout", 1091, 24),
    makeEvent("RunTask", 1119.8, 40),
    makeMark(`${RESIZE_MARK_PREFIX}1110`, 1120),
    makeEvent("FunctionCall", 1125, 20, "performWorkUntilDeadline"),
    makeEvent("RunTask", 1170, 4),
  ];
}

describe("summarizeResizeTrace", () => {
  it("refuses a trace the sweep did not mark", () => {
    expect(() => summarizeResizeTrace([])).toThrow(IDLE_START_MARK);
  });

  it("counts one resize event per mark", () => {
    expect(summarizeResizeTrace(makeSweepEvents()).resizeEvents).toBe(2);
  });

  it("reports the median layout objects across the sweep", () => {
    const layout = makeEvent("Layout", 1200, 1);
    const events = [
      ...makeSweepEvents(),
      { ...layout, args: { beginData: { totalObjects: 5000 } } },
      {
        ...layout,
        ts: 1300 * 1000,
        args: { beginData: { totalObjects: 28000 } },
      },
      {
        ...layout,
        ts: 1400 * 1000,
        args: { beginData: { totalObjects: 5000 } },
      },
    ];

    expect(summarizeResizeTrace(events).layoutObjects).toBe(5000);
  });

  it("reads layout objects from the page's frame, not the overlay's", () => {
    function makeFrameLayout(atMs: number, frame: string, total: number) {
      const layout = makeEvent("Layout", atMs, 1);
      return { ...layout, args: { beginData: { frame, totalObjects: total } } };
    }
    const events = [
      ...makeSweepEvents(),
      makeFrameLayout(1200, "overlay", 4),
      makeFrameLayout(1210, "overlay", 4),
      makeFrameLayout(1220, "overlay", 4),
      makeFrameLayout(1230, "page", 28000),
    ];

    expect(summarizeResizeTrace(events).layoutObjects).toBe(28000);
  });

  it("ignores another thread's events", () => {
    const stranger = { ...makeEvent("Layout", 1500, 50), tid: PAGE_TID + 1 };

    const summary = summarizeResizeTrace([...makeSweepEvents(), stranger]);

    expect(summary.postResize.cycles).toBe(0);
  });

  it("names the largest self time as the dominant cost", () => {
    const events = [
      ...makeSweepEvents(),
      makeEvent("FunctionCall", 1200, 40),
      makeEvent("Layout", 1210, 30),
    ];

    const summary = summarizeResizeTrace(events);

    expect(summary.costMs.layout).toBe(62);
    expect(summary.costMs.script).toBe(30);
    expect(summary.dominantCost).toBe("layout");
  });

  it("charges a step with its layout task and the task holding its mark", () => {
    const summary = summarizeResizeTrace(makeSweepEvents());

    expect(summary.stepMedianMs).toBe(22);
    expect(summary.stepMaxMs).toBe(70);
  });

  it("reads the frame that first reaches the breakpoint", () => {
    const summary = summarizeResizeTrace(makeSweepEvents());

    expect(summary.crossingFrameMs).toBe(70);
    expect(summary.crossingLongestTaskMs).toBe(40);
  });

  it("reports no crossing when no width reaches the breakpoint", () => {
    const events = [
      makeMark(IDLE_START_MARK, 0),
      makeMark(`${RESIZE_MARK_PREFIX}1200`, 1000),
    ];

    expect(summarizeResizeTrace(events).crossingFrameMs).toBe(0);
  });

  it("buckets from the sweep start when the first width is past it", () => {
    const events = [
      makeMark(IDLE_START_MARK, 0),
      makeMark(SWEEP_START_MARK, 900),
      makeEvent("RunTask", 950, 20),
      makeEvent("RunTask", 999.8, 15),
      makeMark(`${RESIZE_MARK_PREFIX}1000`, 1000),
    ];

    const summary = summarizeResizeTrace(events);

    expect(summary.crossingFrameMs).toBe(35);
    expect(summary.crossingLongestTaskMs).toBe(20);
  });

  it("allows the task holding the last mark and one frame after it", () => {
    const events = [
      ...makeSweepEvents(),
      makeEvent("FunctionCall", 1150, 5),
      makeEvent("Layout", 1165, 5),
    ];

    const { cycles, lastWorkAfterMs } = summarizeResizeTrace(events).postResize;

    expect(cycles).toBe(0);
    expect(lastWorkAfterMs).toBe(0);
  });

  it("counts a lone layout later than that frame as a cycle", () => {
    const events = [...makeSweepEvents(), makeEvent("Layout", 1400, 5)];

    const { cycles, layoutMs, lastWorkAfterMs } =
      summarizeResizeTrace(events).postResize;

    expect(cycles).toBe(1);
    expect(layoutMs).toBe(5);
    expect(lastWorkAfterMs).toBe(285);
  });

  it("charges work that starts in the allowance and runs past it", () => {
    const events = [...makeSweepEvents(), makeEvent("Layout", 1165, 500)];

    const { cycles, layoutMs } = summarizeResizeTrace(events).postResize;

    expect(cycles).toBe(1);
    expect(layoutMs).toBeGreaterThan(400);
  });

  it("counts separated bursts after that frame as cycles", () => {
    const events = [
      ...makeSweepEvents(),
      makeEvent("Layout", 1200, 5),
      makeEvent("FunctionCall", 1206, 4),
      makeEvent("Layout", 1300, 5),
      makeEvent("FunctionCall", 1400, 10),
    ];

    const { cycles, layoutMs, lastWorkAfterMs, scriptMs } =
      summarizeResizeTrace(events).postResize;

    expect(cycles).toBe(3);
    expect(layoutMs).toBe(10);
    expect(scriptMs).toBe(14);
    expect(lastWorkAfterMs).toBe(290);
  });

  it("does not count the frame probe as the page's work", () => {
    const events = [
      ...makeSweepEvents(),
      makeEvent("FunctionCall", 1300, 5, FRAME_PROBE_FUNCTION),
    ];

    const { postResize, topFunctions } = summarizeResizeTrace(events);

    expect(postResize.cycles).toBe(0);
    expect(topFunctions.map((entry) => entry.name)).toEqual([
      "performWorkUntilDeadline",
    ]);
  });

  it("does not charge the frame probe's parent as late script", () => {
    const events = [
      ...makeSweepEvents(),
      makeEvent("FireAnimationFrame", 1300, 6),
      makeEvent("FunctionCall", 1300.5, 5, FRAME_PROBE_FUNCTION),
    ];

    const { cycles, scriptMs } = summarizeResizeTrace(events).postResize;

    expect(cycles).toBe(0);
    expect(scriptMs).toBe(0);
  });

  it("does not count the DevTools overlay as the page's work", () => {
    const events = [
      ...makeSweepEvents(),
      makeEvent("FunctionCall", 1300, 5, "window.dispatch"),
    ];

    expect(summarizeResizeTrace(events).postResize.cycles).toBe(0);
  });

  it("drops engine no-op passes under the noise floor", () => {
    const events = [
      ...makeSweepEvents(),
      makeEvent("UpdateLayoutTree", 1300, 0.05),
    ];

    expect(summarizeResizeTrace(events).postResize.cycles).toBe(0);
  });

  it("reads the quiet window's cycles as the noise floor", () => {
    const events = [
      makeMark(IDLE_START_MARK, 0),
      makeEvent("FunctionCall", 100, 2),
      makeEvent("FunctionCall", 400, 2),
      ...makeSweepEvents().filter((event) => event.name !== IDLE_START_MARK),
    ];

    expect(summarizeResizeTrace(events).idleCycles).toBe(2);
  });
});
