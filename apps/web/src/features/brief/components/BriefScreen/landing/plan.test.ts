import { describe, expect, it } from "vitest";

import { planLanding } from "./plan";
import {
  LandingActionKinds,
  LandingPhases,
  LandPlacements,
  type LandingReading,
  type LandingRequest,
  type LandingState,
  type MountedTarget,
  type SettleState,
} from "./types";

const VIEWPORT_HEIGHT = 800;
const STACK_TOP = 150;

function makeReading(
  target: MountedTarget | undefined,
  scrollY = 1000,
): LandingReading {
  return {
    target,
    scrollY,
    viewportHeight: VIEWPORT_HEIGHT,
    underStackTop: STACK_TOP,
  };
}

function makeTarget(top: number, hidden = false): MountedTarget {
  return { top, hidden };
}

function makeSettleState(overrides: Partial<SettleState> = {}): SettleState {
  return {
    phase: LandingPhases.SETTLE,
    frames: 0,
    stillFrames: 0,
    hasMoved: false,
    awaitStart: false,
    lastScrollY: 1000,
    placedOffset: undefined,
    ...overrides,
  };
}

const UNDER_STACK: LandingRequest = {
  placement: LandPlacements.UNDER_STACK,
  behavior: "smooth",
};
const VIEWPORT_TOP: LandingRequest = {
  placement: LandPlacements.VIEWPORT_TOP,
  behavior: "smooth",
};

const JUMP: LandingState = { phase: LandingPhases.JUMP };

describe("planLanding defer", () => {
  it("waits out the deferred frames before the jump", () => {
    const first = planLanding(
      { phase: LandingPhases.DEFER, framesLeft: 2 },
      makeReading(makeTarget(200)),
      UNDER_STACK,
    );
    expect(first).toEqual({
      action: { kind: LandingActionKinds.WAIT },
      next: { phase: LandingPhases.DEFER, framesLeft: 1 },
    });

    const second = planLanding(
      { phase: LandingPhases.DEFER, framesLeft: 1 },
      makeReading(makeTarget(200)),
      UNDER_STACK,
    );
    expect(second.next).toEqual(JUMP);
  });
});

describe("planLanding jump", () => {
  it("does nothing for a target inside a hidden pane", () => {
    const step = planLanding(
      JUMP,
      makeReading(makeTarget(0, true)),
      VIEWPORT_TOP,
    );
    expect(step).toEqual({
      action: { kind: LandingActionKinds.WAIT },
      next: undefined,
    });
  });

  it("scrolls a near target into view and ends at the viewport top", () => {
    const step = planLanding(JUMP, makeReading(makeTarget(900)), VIEWPORT_TOP);
    expect(step).toEqual({
      action: { kind: LandingActionKinds.SCROLL_INTO_VIEW, behavior: "smooth" },
      next: undefined,
    });
  });

  it("scrolls a near target under the stack, then waits for the glide", () => {
    const step = planLanding(JUMP, makeReading(makeTarget(900)), UNDER_STACK);
    expect(step.action).toEqual({
      kind: LandingActionKinds.SCROLL_TO,
      top: 1750,
      behavior: "smooth",
    });
    expect(step.next).toEqual(
      makeSettleState({ awaitStart: true, lastScrollY: undefined }),
    );
  });

  it("never aims an under-stack scroll above the page top", () => {
    const step = planLanding(JUMP, makeReading(makeTarget(20), 0), UNDER_STACK);
    expect(step.action).toEqual({
      kind: LandingActionKinds.SCROLL_TO,
      top: 0,
      behavior: "smooth",
    });
  });

  it.each([
    ["below", 2401],
    ["above", -2401],
  ])("jumps instantly to a far target %s the viewport", (_where, top) => {
    const step = planLanding(JUMP, makeReading(makeTarget(top)), UNDER_STACK);
    expect(step.action).toEqual({
      kind: LandingActionKinds.SCROLL_INTO_VIEW,
      behavior: "instant",
    });
    expect(step.next).toEqual(makeSettleState({ lastScrollY: undefined }));
  });

  it("asks the windowed lists for a target that is not mounted", () => {
    const step = planLanding(JUMP, makeReading(undefined), VIEWPORT_TOP);
    expect(step.action).toEqual({ kind: LandingActionKinds.ASK_WINDOWS });
    expect(step.next).toEqual(makeSettleState({ lastScrollY: undefined }));
  });
});

describe("planLanding settle", () => {
  it("keeps polling while the target has not mounted", () => {
    const step = planLanding(
      makeSettleState({ frames: 10 }),
      makeReading(undefined),
      VIEWPORT_TOP,
    );
    expect(step.action).toEqual({ kind: LandingActionKinds.WAIT });
    expect(step.next).toMatchObject({ frames: 11 });
  });

  it("gives up on a target that never mounts", () => {
    const step = planLanding(
      makeSettleState({ frames: 89 }),
      makeReading(undefined),
      VIEWPORT_TOP,
    );
    expect(step.next).toBeUndefined();
  });

  it("takes a fresh scroll baseline after its own scroll", () => {
    const step = planLanding(
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
    const step = planLanding(
      makeSettleState({ stillFrames: 2, lastScrollY: 900 }),
      makeReading(makeTarget(500), 1000),
      VIEWPORT_TOP,
    );
    expect(step.action).toEqual({ kind: LandingActionKinds.WAIT });
    expect(step.next).toMatchObject({ stillFrames: 0, hasMoved: true });
  });

  it("corrects onto the resting line once the scroll rests", () => {
    const step = planLanding(
      makeSettleState({ stillFrames: 2 }),
      makeReading(makeTarget(500)),
      UNDER_STACK,
    );
    expect(step.action).toEqual({
      kind: LandingActionKinds.SCROLL_BY,
      top: 350,
    });
    expect(step.next).toMatchObject({
      placedOffset: 1500,
      lastScrollY: undefined,
      stillFrames: 3,
    });
  });

  it("rests at the viewport top for a viewport-top landing", () => {
    const step = planLanding(
      makeSettleState({ stillFrames: 2 }),
      makeReading(makeTarget(500)),
      VIEWPORT_TOP,
    );
    expect(step.action).toEqual({
      kind: LandingActionKinds.SCROLL_BY,
      top: 500,
    });
  });

  it("leaves a landing within the threshold uncorrected but placed", () => {
    const step = planLanding(
      makeSettleState({ stillFrames: 2 }),
      makeReading(makeTarget(STACK_TOP + 8)),
      UNDER_STACK,
    );
    expect(step.action).toEqual({ kind: LandingActionKinds.WAIT });
    expect(step.next).toMatchObject({ placedOffset: 1158 });
  });

  it("does not count stillness before a smooth scroll starts", () => {
    const step = planLanding(
      makeSettleState({ awaitStart: true, stillFrames: 0, frames: 5 }),
      makeReading(makeTarget(500)),
      UNDER_STACK,
    );
    expect(step.next).toMatchObject({ stillFrames: 0 });
  });

  it("counts stillness once a smooth scroll is past its start window", () => {
    const step = planLanding(
      makeSettleState({ awaitStart: true, stillFrames: 0, frames: 12 }),
      makeReading(makeTarget(500)),
      UNDER_STACK,
    );
    expect(step.next).toMatchObject({ stillFrames: 1 });
  });

  it("ends the watch when someone else scrolls the placed target", () => {
    const step = planLanding(
      makeSettleState({ placedOffset: 1500, lastScrollY: 1000 }),
      makeReading(makeTarget(300), 1200),
      UNDER_STACK,
    );
    expect(step.next).toBeUndefined();
  });

  it("ends the watch on an outside scroll that drifts the target 0.5px", () => {
    const step = planLanding(
      makeSettleState({ placedOffset: 1500, lastScrollY: 1000 }),
      makeReading(makeTarget(300.5), 1200),
      UNDER_STACK,
    );
    expect(step.next).toBeUndefined();
  });

  it("does not re-place a target that drifted under a pixel", () => {
    const step = planLanding(
      makeSettleState({ placedOffset: 1150, stillFrames: 7 }),
      makeReading(makeTarget(150.5)),
      UNDER_STACK,
    );
    expect(step.action).toEqual({ kind: LandingActionKinds.WAIT });
    expect(step.next).toMatchObject({ placedOffset: 1150 });
  });

  it("corrects again when a reflow moves the placed target", () => {
    const step = planLanding(
      makeSettleState({ placedOffset: 1150, stillFrames: 2 }),
      makeReading(makeTarget(900)),
      UNDER_STACK,
    );
    expect(step.action).toEqual({
      kind: LandingActionKinds.SCROLL_BY,
      top: 750,
    });
    expect(step.next).toMatchObject({ placedOffset: 1900 });
  });

  it("re-places a target a reflow moved while the page stayed still", () => {
    const step = planLanding(
      makeSettleState({ placedOffset: 1150, stillFrames: 7 }),
      makeReading(makeTarget(400)),
      UNDER_STACK,
    );
    expect(step.action).toEqual({
      kind: LandingActionKinds.SCROLL_BY,
      top: 250,
    });
  });

  it("leaves a placed target alone while it has not moved", () => {
    const step = planLanding(
      makeSettleState({ placedOffset: 1150, stillFrames: 2 }),
      makeReading(makeTarget(STACK_TOP)),
      UNDER_STACK,
    );
    expect(step.action).toEqual({ kind: LandingActionKinds.WAIT });
    expect(step.next).toMatchObject({ placedOffset: 1150 });
  });

  it("ends the watch once its frame budget is spent", () => {
    const step = planLanding(
      makeSettleState({ frames: 299, placedOffset: 1150 }),
      makeReading(makeTarget(STACK_TOP)),
      UNDER_STACK,
    );
    expect(step.next).toBeUndefined();
  });

  it("ends the watch when the placed target unmounts", () => {
    const step = planLanding(
      makeSettleState({ placedOffset: 1150 }),
      makeReading(undefined),
      UNDER_STACK,
    );
    expect(step.next).toBeUndefined();
  });

  it("ends the landing when the target's pane is hidden", () => {
    const step = planLanding(
      makeSettleState({ stillFrames: 2 }),
      makeReading(makeTarget(0, true)),
      UNDER_STACK,
    );
    expect(step).toEqual({
      action: { kind: LandingActionKinds.WAIT },
      next: undefined,
    });
  });
});
