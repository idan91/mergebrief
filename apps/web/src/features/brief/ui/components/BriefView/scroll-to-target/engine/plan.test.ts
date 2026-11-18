import { describe, expect, it } from "vitest";

import { deriveRowScrollCorrection, planScrollFrame } from "./plan";
import {
  ScrollActionKinds,
  ScrollPhases,
  ScrollPlacements,
  type ScrollReading,
  type ScrollRequest,
  type ScrollState,
  type MountedTarget,
  type SettleState,
} from "./types";

const VIEWPORT_HEIGHT = 800;
const STACK_HEIGHT = 110;
const SCROLL_GAP = 40;
/** The pinned stack plus the 40px scroll gap. */
const STACK_TOP = 150;
const ROW_HEIGHT = 44;

function makeReading(
  target: MountedTarget | undefined,
  scrollY = 1000,
): ScrollReading {
  return {
    target,
    scrollY,
    viewportHeight: VIEWPORT_HEIGHT,
    stackHeight: STACK_HEIGHT,
    scrollGap: SCROLL_GAP,
  };
}

function makeTarget(
  top: number,
  hidden = false,
  height = ROW_HEIGHT,
): MountedTarget {
  return { top, bottom: top + height, hidden };
}

function makeSettleState(overrides: Partial<SettleState> = {}): SettleState {
  return {
    phase: ScrollPhases.SETTLE,
    frames: 0,
    stillFrames: 0,
    hasMoved: false,
    awaitStart: false,
    lastScrollY: 1000,
    placedOffset: undefined,
    ...overrides,
  };
}

const UNDER_STACK: ScrollRequest = {
  placement: ScrollPlacements.UNDER_STACK,
  behavior: "smooth",
};
const VIEWPORT_TOP: ScrollRequest = {
  placement: ScrollPlacements.VIEWPORT_TOP,
  behavior: "smooth",
};
const READING_BAND: ScrollRequest = {
  placement: ScrollPlacements.READING_BAND,
  behavior: "smooth",
};

const JUMP: ScrollState = { phase: ScrollPhases.JUMP };

describe("planScrollFrame defer", () => {
  it("waits out the deferred frames before the jump", () => {
    const first = planScrollFrame(
      { phase: ScrollPhases.DEFER, framesLeft: 2 },
      makeReading(makeTarget(200)),
      UNDER_STACK,
    );
    expect(first).toEqual({
      action: { kind: ScrollActionKinds.WAIT },
      next: { phase: ScrollPhases.DEFER, framesLeft: 1 },
    });

    const second = planScrollFrame(
      { phase: ScrollPhases.DEFER, framesLeft: 1 },
      makeReading(makeTarget(200)),
      UNDER_STACK,
    );
    expect(second.next).toEqual(JUMP);
  });
});

describe("planScrollFrame jump", () => {
  it("does nothing for a target inside a hidden pane", () => {
    const step = planScrollFrame(
      JUMP,
      makeReading(makeTarget(0, true)),
      VIEWPORT_TOP,
    );
    expect(step).toEqual({
      action: { kind: ScrollActionKinds.WAIT },
      next: undefined,
    });
  });

  it("scrolls a near target to the viewport top, then waits for the glide", () => {
    const step = planScrollFrame(
      JUMP,
      makeReading(makeTarget(900)),
      VIEWPORT_TOP,
    );
    expect(step).toEqual({
      action: {
        kind: ScrollActionKinds.SCROLL_INTO_VIEW,
        behavior: "smooth",
        block: "start",
      },
      next: makeSettleState({ awaitStart: true, lastScrollY: undefined }),
    });
  });

  it("scrolls a near target under the stack, then waits for the glide", () => {
    const step = planScrollFrame(
      JUMP,
      makeReading(makeTarget(900)),
      UNDER_STACK,
    );
    expect(step.action).toEqual({
      kind: ScrollActionKinds.SCROLL_TO,
      top: 1750,
      behavior: "smooth",
    });
    expect(step.next).toEqual(
      makeSettleState({ awaitStart: true, lastScrollY: undefined }),
    );
  });

  it("never aims an under-stack scroll above the page top", () => {
    const step = planScrollFrame(
      JUMP,
      makeReading(makeTarget(20), 0),
      UNDER_STACK,
    );
    expect(step.action).toEqual({
      kind: ScrollActionKinds.SCROLL_TO,
      top: 0,
      behavior: "smooth",
    });
  });

  it.each([
    ["below", 2401],
    ["above", -2401],
  ])("jumps instantly to a far target %s the viewport", (_where, top) => {
    const step = planScrollFrame(
      JUMP,
      makeReading(makeTarget(top)),
      UNDER_STACK,
    );
    expect(step.action).toEqual({
      kind: ScrollActionKinds.SCROLL_INTO_VIEW,
      behavior: "instant",
      block: "start",
    });
    expect(step.next).toEqual(makeSettleState({ lastScrollY: undefined }));
  });

  it("centers a near row, then waits for the glide", () => {
    const step = planScrollFrame(
      JUMP,
      makeReading(makeTarget(900)),
      READING_BAND,
    );
    expect(step.action).toEqual({
      kind: ScrollActionKinds.SCROLL_INTO_VIEW,
      behavior: "smooth",
      block: "center",
    });
    expect(step.next).toEqual(
      makeSettleState({ awaitStart: true, lastScrollY: undefined }),
    );
  });

  it("jumps instantly to a far row and centers it", () => {
    const step = planScrollFrame(
      JUMP,
      makeReading(makeTarget(9000)),
      READING_BAND,
    );
    expect(step.action).toEqual({
      kind: ScrollActionKinds.SCROLL_INTO_VIEW,
      behavior: "instant",
      block: "center",
    });
    expect(step.next).toEqual(makeSettleState({ lastScrollY: undefined }));
  });

  it("asks the windowed lists for a target that is not mounted", () => {
    const step = planScrollFrame(JUMP, makeReading(undefined), VIEWPORT_TOP);
    expect(step.action).toEqual({ kind: ScrollActionKinds.ASK_WINDOWS });
    expect(step.next).toEqual(makeSettleState({ lastScrollY: undefined }));
  });
});

describe("planScrollFrame settle", () => {
  it("keeps polling while the target has not mounted", () => {
    const step = planScrollFrame(
      makeSettleState({ frames: 10 }),
      makeReading(undefined),
      VIEWPORT_TOP,
    );
    expect(step.action).toEqual({ kind: ScrollActionKinds.WAIT });
    expect(step.next).toMatchObject({ frames: 11 });
  });

  it("gives up on a target that never mounts", () => {
    const step = planScrollFrame(
      makeSettleState({ frames: 89 }),
      makeReading(undefined),
      VIEWPORT_TOP,
    );
    expect(step.next).toBeUndefined();
  });

  it("takes a fresh scroll baseline after its own scroll action", () => {
    const step = planScrollFrame(
      makeSettleState({ lastScrollY: undefined }),
      makeReading(makeTarget(500), 4000),
      VIEWPORT_TOP,
    );
    expect(step.next).toMatchObject({
      lastScrollY: 4000,
      stillFrames: 1,
      hasMoved: false,
    });
  });

  it("resets the rest count while the page still scrolls", () => {
    const step = planScrollFrame(
      makeSettleState({ stillFrames: 2, lastScrollY: 900 }),
      makeReading(makeTarget(500), 1000),
      VIEWPORT_TOP,
    );
    expect(step.action).toEqual({ kind: ScrollActionKinds.WAIT });
    expect(step.next).toMatchObject({ stillFrames: 0, hasMoved: true });
  });

  it("corrects onto the resting line once the scroll rests", () => {
    const step = planScrollFrame(
      makeSettleState({ stillFrames: 2 }),
      makeReading(makeTarget(500)),
      UNDER_STACK,
    );
    expect(step.action).toEqual({
      kind: ScrollActionKinds.SCROLL_BY,
      top: 350,
    });
    expect(step.next).toMatchObject({
      placedOffset: 1500,
      lastScrollY: undefined,
      stillFrames: 3,
    });
  });

  it("rests at the viewport top for a viewport-top scroll", () => {
    const step = planScrollFrame(
      makeSettleState({ stillFrames: 2 }),
      makeReading(makeTarget(500)),
      VIEWPORT_TOP,
    );
    expect(step.action).toEqual({
      kind: ScrollActionKinds.SCROLL_BY,
      top: 500,
    });
  });

  it("leaves a scroll within the threshold uncorrected but placed", () => {
    const step = planScrollFrame(
      makeSettleState({ stillFrames: 2 }),
      makeReading(makeTarget(STACK_TOP + 8)),
      UNDER_STACK,
    );
    expect(step.action).toEqual({ kind: ScrollActionKinds.WAIT });
    expect(step.next).toMatchObject({ placedOffset: 1158 });
  });

  it("leaves a row that rests readable in the band where it is", () => {
    const step = planScrollFrame(
      makeSettleState({ stillFrames: 2 }),
      makeReading(makeTarget(400)),
      READING_BAND,
    );
    expect(step.action).toEqual({ kind: ScrollActionKinds.WAIT });
    expect(step.next).toMatchObject({ placedOffset: 1400 });
  });

  it("moves a row under the stack a third of the way down the band", () => {
    const step = planScrollFrame(
      makeSettleState({ stillFrames: 2 }),
      makeReading(makeTarget(50)),
      READING_BAND,
    );
    expect(step.action).toEqual({
      kind: ScrollActionKinds.SCROLL_BY,
      top: -290,
    });
  });

  it("puts a row taller than the band head first under the stack", () => {
    const step = planScrollFrame(
      makeSettleState({ stillFrames: 2 }),
      makeReading(makeTarget(-300, false, 900)),
      READING_BAND,
    );
    expect(step.action).toEqual({
      kind: ScrollActionKinds.SCROLL_BY,
      top: -426,
    });
  });

  it("does not count stillness before a smooth scroll action starts", () => {
    const step = planScrollFrame(
      makeSettleState({ awaitStart: true, stillFrames: 0, frames: 5 }),
      makeReading(makeTarget(500)),
      UNDER_STACK,
    );
    expect(step.next).toMatchObject({ stillFrames: 0 });
  });

  it("counts stillness once a smooth scroll action is past its start window", () => {
    const step = planScrollFrame(
      makeSettleState({ awaitStart: true, stillFrames: 0, frames: 12 }),
      makeReading(makeTarget(500)),
      UNDER_STACK,
    );
    expect(step.next).toMatchObject({ stillFrames: 1 });
  });

  it("ends the watch when someone else scrolls the placed target", () => {
    const step = planScrollFrame(
      makeSettleState({ placedOffset: 1500, lastScrollY: 1000 }),
      makeReading(makeTarget(300), 1200),
      UNDER_STACK,
    );
    expect(step.next).toBeUndefined();
  });

  it("ends the watch on an outside scroll that drifts the target 0.5px", () => {
    const step = planScrollFrame(
      makeSettleState({ placedOffset: 1500, lastScrollY: 1000 }),
      makeReading(makeTarget(300.5), 1200),
      UNDER_STACK,
    );
    expect(step.next).toBeUndefined();
  });

  it("does not re-place a target that drifted under a pixel", () => {
    const step = planScrollFrame(
      makeSettleState({ placedOffset: 1150, stillFrames: 7 }),
      makeReading(makeTarget(150.5)),
      UNDER_STACK,
    );
    expect(step.action).toEqual({ kind: ScrollActionKinds.WAIT });
    expect(step.next).toMatchObject({ placedOffset: 1150 });
  });

  it("corrects again when a reflow moves the placed target", () => {
    const step = planScrollFrame(
      makeSettleState({ placedOffset: 1150, stillFrames: 2 }),
      makeReading(makeTarget(900)),
      UNDER_STACK,
    );
    expect(step.action).toEqual({
      kind: ScrollActionKinds.SCROLL_BY,
      top: 750,
    });
    expect(step.next).toMatchObject({ placedOffset: 1900 });
  });

  it("re-places a target a reflow moved while the page stayed still", () => {
    const step = planScrollFrame(
      makeSettleState({ placedOffset: 1150, stillFrames: 7 }),
      makeReading(makeTarget(400)),
      UNDER_STACK,
    );
    expect(step.action).toEqual({
      kind: ScrollActionKinds.SCROLL_BY,
      top: 250,
    });
  });

  it("leaves a placed target alone while it has not moved", () => {
    const step = planScrollFrame(
      makeSettleState({ placedOffset: 1150, stillFrames: 2 }),
      makeReading(makeTarget(STACK_TOP)),
      UNDER_STACK,
    );
    expect(step.action).toEqual({ kind: ScrollActionKinds.WAIT });
    expect(step.next).toMatchObject({ placedOffset: 1150 });
  });

  it("ends the watch once its frame budget is spent", () => {
    const step = planScrollFrame(
      makeSettleState({ frames: 299, placedOffset: 1150 }),
      makeReading(makeTarget(STACK_TOP)),
      UNDER_STACK,
    );
    expect(step.next).toBeUndefined();
  });

  it("ends the watch when the placed target unmounts", () => {
    const step = planScrollFrame(
      makeSettleState({ placedOffset: 1150 }),
      makeReading(undefined),
      UNDER_STACK,
    );
    expect(step.next).toBeUndefined();
  });

  it("ends the scroll when the target's pane is hidden", () => {
    const step = planScrollFrame(
      makeSettleState({ stillFrames: 2 }),
      makeReading(makeTarget(0, true)),
      UNDER_STACK,
    );
    expect(step).toEqual({
      action: { kind: ScrollActionKinds.WAIT },
      next: undefined,
    });
  });
});

describe("deriveRowScrollCorrection", () => {
  // Viewport 1000 under a 190px pinned stack: the band is 190 to 1000,
  // middle 595, a third of the way down 460.
  it("leaves a row already in the band's upper half", () => {
    expect(
      deriveRowScrollCorrection({ top: 400, bottom: 444 }, 190, 1000),
    ).toBe(0);
  });

  it("moves a row parked under the pinned stack a third of the way down", () => {
    expect(
      deriveRowScrollCorrection({ top: 141, bottom: 185 }, 190, 1000),
    ).toBe(-319);
  });

  it("moves a row past the viewport bottom a third of the way down", () => {
    expect(
      deriveRowScrollCorrection({ top: 980, bottom: 1024 }, 190, 1000),
    ).toBe(520);
  });

  it("moves a row that fits in the lower half up, never leaves it low", () => {
    expect(
      deriveRowScrollCorrection({ top: 800, bottom: 844 }, 190, 1000),
    ).toBe(340);
  });

  it("leaves a medium row that is whole in the band with its top high", () => {
    expect(
      deriveRowScrollCorrection({ top: 200, bottom: 900 }, 190, 1000),
    ).toBe(0);
    expect(
      deriveRowScrollCorrection({ top: 300, bottom: 800 }, 190, 1000),
    ).toBe(0);
  });

  it("moves a medium row that runs past the viewport bottom", () => {
    expect(
      deriveRowScrollCorrection({ top: 600, bottom: 1100 }, 190, 1000),
    ).toBe(140);
  });

  it("leaves a tall row whose head is already in the upper band", () => {
    expect(
      deriveRowScrollCorrection({ top: 200, bottom: 1100 }, 190, 1000),
    ).toBe(0);
  });

  it("puts a tall row's head under the stack, never centres it", () => {
    expect(deriveRowScrollCorrection({ top: 50, bottom: 950 }, 190, 1000)).toBe(
      -156,
    );
  });

  it("pulls up a tall row whose head sits low in the band", () => {
    expect(
      deriveRowScrollCorrection({ top: 800, bottom: 1700 }, 190, 1000),
    ).toBe(594);
  });
});
