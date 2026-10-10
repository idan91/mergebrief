import { describe, expect, it } from "vitest";

import { deriveRowIntent } from "./gestures";
import {
  DragModes,
  type LineRowState,
  type ReasonRowState,
  type RowEffect,
  RowEffects,
  type RowGesture,
  RowGestureKinds,
  type RowIntent,
  type RowState,
  RowStateKinds,
  type RowTarget,
  RowTargets,
} from "./types";

const ENTER = "Enter";
const SPACE = " ";
const ESCAPE = "Escape";

const {
  DROP_TEXT_SELECTION,
  BEGIN_SELECT_DRAG,
  BEGIN_COMMENT_DRAG,
  MOVE_DRAG,
  CLEAR_DRAG,
  MARK_SELECTING_SIDE,
  SELECT_RANGE,
  EXTEND_SELECTION,
  CLEAR_SELECTION,
  COMMENT_RANGE,
  COMMENT_SELECTION,
  TOGGLE_REASON,
  CLOSE_REASON,
} = RowEffects;
const { BUTTON, NUMBERS, SIGN, CODE } = RowTargets;

const SELECT_DRAG_ELSEWHERE = { mode: DragModes.SELECT, startedHere: false };
const COMMENT_DRAG_ELSEWHERE = { mode: DragModes.COMMENT, startedHere: false };
const SELECT_DRAG_HERE = { mode: DragModes.SELECT, startedHere: true };

function stubLineState(overrides: Partial<LineRowState> = {}): LineRowState {
  return {
    kind: RowStateKinds.LINE,
    drag: undefined,
    composerOpen: false,
    hasSelection: false,
    reanchorArmed: false,
    lineSelected: false,
    commentable: true,
    split: false,
    ...overrides,
  };
}

function stubReasonState(
  overrides: Partial<ReasonRowState> = {},
): ReasonRowState {
  return {
    kind: RowStateKinds.REASON,
    drag: undefined,
    composerOpen: false,
    hasSelection: false,
    reasonOpen: false,
    ...overrides,
  };
}

function makeKeyDown(
  key: string,
  shift = false,
  target: RowTarget = CODE,
): RowGesture {
  return { kind: RowGestureKinds.KEY_DOWN, key, shift, target };
}

function makeMouseDown(target: RowTarget, shift = false): RowGesture {
  return { kind: RowGestureKinds.MOUSE_DOWN, shift, target };
}

function makeMouseUp(
  target: RowTarget,
  overrides: {
    primary?: boolean;
    shift?: boolean;
    textSelected?: boolean;
  } = {},
): RowGesture {
  return {
    kind: RowGestureKinds.MOUSE_UP,
    primary: true,
    shift: false,
    textSelected: false,
    target,
    ...overrides,
  };
}

const MOUSE_ENTER: RowGesture = { kind: RowGestureKinds.MOUSE_ENTER };

function makeIntent(
  effects: RowEffect[],
  flags: { preventDefault?: boolean; stopPropagation?: boolean } = {},
): RowIntent {
  return {
    effects,
    preventDefault: flags.preventDefault ?? false,
    stopPropagation: flags.stopPropagation ?? false,
  };
}

const NOTHING = makeIntent([]);

interface IntentCase {
  name: string;
  gesture: RowGesture;
  state: RowState;
  intent: RowIntent;
}

const LINE_CASES: IntentCase[] = [
  {
    name: "a key on a button inside the row is the button's",
    gesture: makeKeyDown(ENTER, false, BUTTON),
    state: stubLineState({ hasSelection: true, lineSelected: true }),
    intent: NOTHING,
  },
  {
    name: "Enter inside the selection comments on all of it",
    gesture: makeKeyDown(ENTER),
    state: stubLineState({ hasSelection: true, lineSelected: true }),
    intent: makeIntent([COMMENT_SELECTION]),
  },
  {
    name: "Enter inside the selection places an armed draft on this row",
    gesture: makeKeyDown(ENTER),
    state: stubLineState({ lineSelected: true, reanchorArmed: true }),
    intent: makeIntent([COMMENT_RANGE]),
  },
  {
    name: "Enter outside the selection comments on this row",
    gesture: makeKeyDown(ENTER),
    state: stubLineState({ hasSelection: true }),
    intent: makeIntent([COMMENT_RANGE]),
  },
  {
    name: "Space selects this row",
    gesture: makeKeyDown(SPACE),
    state: stubLineState(),
    intent: makeIntent([SELECT_RANGE], { preventDefault: true }),
  },
  {
    name: "Shift Space extends the selection to this row",
    gesture: makeKeyDown(SPACE, true),
    state: stubLineState({ hasSelection: true }),
    intent: makeIntent([EXTEND_SELECTION], { preventDefault: true }),
  },
  {
    name: "Space places an armed draft on this row",
    gesture: makeKeyDown(SPACE),
    state: stubLineState({ reanchorArmed: true }),
    intent: makeIntent([COMMENT_RANGE], { preventDefault: true }),
  },
  {
    name: "Shift Space still places an armed draft",
    gesture: makeKeyDown(SPACE, true),
    state: stubLineState({ reanchorArmed: true }),
    intent: makeIntent([COMMENT_RANGE], { preventDefault: true }),
  },
  {
    name: "Escape clears a selection and keeps the key",
    gesture: makeKeyDown(ESCAPE),
    state: stubLineState({ hasSelection: true }),
    intent: makeIntent([CLEAR_SELECTION], { stopPropagation: true }),
  },
  {
    name: "Escape passes through while the composer is open",
    gesture: makeKeyDown(ESCAPE),
    state: stubLineState({ hasSelection: true, composerOpen: true }),
    intent: NOTHING,
  },
  {
    name: "Escape passes through with no selection",
    gesture: makeKeyDown(ESCAPE),
    state: stubLineState(),
    intent: NOTHING,
  },
  {
    name: "any other key passes through",
    gesture: makeKeyDown("a"),
    state: stubLineState({ hasSelection: true }),
    intent: NOTHING,
  },
  {
    name: "a press on a button inside the row is the button's",
    gesture: makeMouseDown(BUTTON),
    state: stubLineState({ hasSelection: true, split: true }),
    intent: NOTHING,
  },
  {
    name: "a press on the numbers begins a selection drag",
    gesture: makeMouseDown(NUMBERS),
    state: stubLineState(),
    intent: makeIntent([DROP_TEXT_SELECTION, BEGIN_SELECT_DRAG], {
      preventDefault: true,
    }),
  },
  {
    name: "a Shift press on the numbers extends the selection",
    gesture: makeMouseDown(NUMBERS, true),
    state: stubLineState({ hasSelection: true }),
    intent: makeIntent([DROP_TEXT_SELECTION, EXTEND_SELECTION], {
      preventDefault: true,
    }),
  },
  {
    name: "a press on the numbers begins a comment drag when armed",
    gesture: makeMouseDown(NUMBERS, true),
    state: stubLineState({ reanchorArmed: true }),
    intent: makeIntent([DROP_TEXT_SELECTION, BEGIN_COMMENT_DRAG], {
      preventDefault: true,
    }),
  },
  {
    name: "a press on the code clears the selection and marks the side",
    gesture: makeMouseDown(CODE),
    state: stubLineState({ hasSelection: true, split: true }),
    intent: makeIntent([CLEAR_SELECTION, MARK_SELECTING_SIDE]),
  },
  {
    name: "a press on the code in unified view clears the selection",
    gesture: makeMouseDown(CODE),
    state: stubLineState({ hasSelection: true }),
    intent: makeIntent([CLEAR_SELECTION]),
  },
  {
    name: "a press on the code with no selection marks the side",
    gesture: makeMouseDown(CODE),
    state: stubLineState({ split: true }),
    intent: makeIntent([MARK_SELECTING_SIDE]),
  },
  {
    name: "a press on the code in unified view with no selection is inert",
    gesture: makeMouseDown(CODE),
    state: stubLineState(),
    intent: NOTHING,
  },
  {
    name: "a press on the sign begins a comment drag",
    gesture: makeMouseDown(SIGN),
    state: stubLineState(),
    intent: makeIntent([DROP_TEXT_SELECTION, BEGIN_COMMENT_DRAG], {
      preventDefault: true,
    }),
  },
  {
    name: "a press on the sign inside the selection waits for the release",
    gesture: makeMouseDown(SIGN),
    state: stubLineState({ hasSelection: true, lineSelected: true }),
    intent: makeIntent([DROP_TEXT_SELECTION], { preventDefault: true }),
  },
  {
    name: "a press on the sign of a row outside the diff is inert",
    gesture: makeMouseDown(SIGN),
    state: stubLineState({ commentable: false }),
    intent: NOTHING,
  },
  {
    name: "entering a row mid-drag moves the drag",
    gesture: MOUSE_ENTER,
    state: stubLineState({ drag: SELECT_DRAG_ELSEWHERE }),
    intent: makeIntent([MOVE_DRAG]),
  },
  {
    name: "entering a row with no drag is inert",
    gesture: MOUSE_ENTER,
    state: stubLineState(),
    intent: NOTHING,
  },
  {
    name: "a release ends a selection drag as a selection",
    gesture: makeMouseUp(BUTTON),
    state: stubLineState({ drag: SELECT_DRAG_ELSEWHERE }),
    intent: makeIntent([SELECT_RANGE]),
  },
  {
    name: "a release ends a comment drag as a comment",
    gesture: makeMouseUp(CODE),
    state: stubLineState({ drag: COMMENT_DRAG_ELSEWHERE }),
    intent: makeIntent([COMMENT_RANGE]),
  },
  {
    name: "a release on a button with no drag is the button's click",
    gesture: makeMouseUp(BUTTON),
    state: stubLineState(),
    intent: NOTHING,
  },
  {
    name: "a release on the code never opens the composer",
    gesture: makeMouseUp(CODE),
    state: stubLineState(),
    intent: NOTHING,
  },
  {
    name: "a release on the numbers with no drag is inert",
    gesture: makeMouseUp(NUMBERS),
    state: stubLineState(),
    intent: NOTHING,
  },
  {
    name: "a release on the sign after a text selection is inert",
    gesture: makeMouseUp(SIGN, { textSelected: true }),
    state: stubLineState(),
    intent: NOTHING,
  },
  {
    name: "a release on the sign inside the selection comments on it",
    gesture: makeMouseUp(SIGN),
    state: stubLineState({ hasSelection: true, lineSelected: true }),
    intent: makeIntent([COMMENT_SELECTION]),
  },
  {
    name: "a release on the sign comments on this row",
    gesture: makeMouseUp(SIGN),
    state: stubLineState(),
    intent: makeIntent([COMMENT_RANGE]),
  },
];

const REASON_CASES: IntentCase[] = [
  {
    name: "a key on a button inside a reason row is the button's",
    gesture: makeKeyDown(ENTER, false, BUTTON),
    state: stubReasonState(),
    intent: NOTHING,
  },
  {
    name: "Enter toggles the reason",
    gesture: makeKeyDown(ENTER),
    state: stubReasonState(),
    intent: makeIntent([TOGGLE_REASON], { preventDefault: true }),
  },
  {
    name: "Space toggles the reason",
    gesture: makeKeyDown(SPACE),
    state: stubReasonState(),
    intent: makeIntent([TOGGLE_REASON], { preventDefault: true }),
  },
  {
    name: "Shift Space on a reason row extends the selection",
    gesture: makeKeyDown(SPACE, true),
    state: stubReasonState({ hasSelection: true }),
    intent: makeIntent([EXTEND_SELECTION], { preventDefault: true }),
  },
  {
    name: "Escape closes an open reason and keeps the key",
    gesture: makeKeyDown(ESCAPE),
    state: stubReasonState({ reasonOpen: true, hasSelection: true }),
    intent: makeIntent([CLOSE_REASON], { stopPropagation: true }),
  },
  {
    name: "Escape on a closed reason clears a selection",
    gesture: makeKeyDown(ESCAPE),
    state: stubReasonState({ hasSelection: true }),
    intent: makeIntent([CLEAR_SELECTION], { stopPropagation: true }),
  },
  {
    name: "Escape on a closed reason passes through with the composer open",
    gesture: makeKeyDown(ESCAPE),
    state: stubReasonState({ hasSelection: true, composerOpen: true }),
    intent: NOTHING,
  },
  {
    name: "Escape on a closed reason passes through with no selection",
    gesture: makeKeyDown(ESCAPE),
    state: stubReasonState(),
    intent: NOTHING,
  },
  {
    name: "any other key on a reason row passes through",
    gesture: makeKeyDown("a"),
    state: stubReasonState({ reasonOpen: true }),
    intent: NOTHING,
  },
  {
    name: "a press on a button inside a reason row is the button's",
    gesture: makeMouseDown(BUTTON),
    state: stubReasonState({ hasSelection: true }),
    intent: NOTHING,
  },
  {
    name: "a press on a reason row's code clears the selection",
    gesture: makeMouseDown(CODE),
    state: stubReasonState({ hasSelection: true }),
    intent: makeIntent([CLEAR_SELECTION]),
  },
  {
    name: "a press on a reason row's code with no selection is inert",
    gesture: makeMouseDown(CODE),
    state: stubReasonState(),
    intent: NOTHING,
  },
  {
    name: "a press on a reason row's sign begins nothing",
    gesture: makeMouseDown(SIGN),
    state: stubReasonState(),
    intent: makeIntent([DROP_TEXT_SELECTION], { preventDefault: true }),
  },
  {
    name: "a press on a reason row's numbers begins a selection drag",
    gesture: makeMouseDown(NUMBERS),
    state: stubReasonState(),
    intent: makeIntent([DROP_TEXT_SELECTION, BEGIN_SELECT_DRAG], {
      preventDefault: true,
    }),
  },
  {
    name: "a Shift press on a reason row's numbers extends the selection",
    gesture: makeMouseDown(NUMBERS, true),
    state: stubReasonState({ hasSelection: true }),
    intent: makeIntent([DROP_TEXT_SELECTION, EXTEND_SELECTION], {
      preventDefault: true,
    }),
  },
  {
    name: "entering a reason row mid-drag moves the drag",
    gesture: MOUSE_ENTER,
    state: stubReasonState({ drag: COMMENT_DRAG_ELSEWHERE }),
    intent: makeIntent([MOVE_DRAG]),
  },
  {
    name: "entering a reason row with no drag is inert",
    gesture: MOUSE_ENTER,
    state: stubReasonState(),
    intent: NOTHING,
  },
  {
    name: "a release on a button in a reason row is the button's",
    gesture: makeMouseUp(BUTTON),
    state: stubReasonState({ drag: SELECT_DRAG_ELSEWHERE }),
    intent: NOTHING,
  },
  {
    name: "a release on a reason row ends a selection drag from elsewhere",
    gesture: makeMouseUp(CODE),
    state: stubReasonState({ drag: SELECT_DRAG_ELSEWHERE }),
    intent: makeIntent([SELECT_RANGE]),
  },
  {
    name: "a release on a reason row ends a comment drag from elsewhere",
    gesture: makeMouseUp(CODE),
    state: stubReasonState({ drag: COMMENT_DRAG_ELSEWHERE }),
    intent: makeIntent([COMMENT_RANGE]),
  },
  {
    name: "a click on a reason row's own numbers toggles the reason",
    gesture: makeMouseUp(NUMBERS),
    state: stubReasonState({ drag: SELECT_DRAG_HERE }),
    intent: makeIntent([CLEAR_DRAG, TOGGLE_REASON]),
  },
  {
    name: "a release on a reason row's sign toggles the reason",
    gesture: makeMouseUp(SIGN),
    state: stubReasonState(),
    intent: makeIntent([CLEAR_DRAG, TOGGLE_REASON]),
  },
  {
    name: "a secondary release on a reason row only clears the drag",
    gesture: makeMouseUp(NUMBERS, { primary: false }),
    state: stubReasonState({ drag: SELECT_DRAG_HERE }),
    intent: makeIntent([CLEAR_DRAG]),
  },
  {
    name: "a Shift release on a reason row only clears the drag",
    gesture: makeMouseUp(NUMBERS, { shift: true }),
    state: stubReasonState(),
    intent: makeIntent([CLEAR_DRAG]),
  },
  {
    name: "a release on a reason row's code only clears the drag",
    gesture: makeMouseUp(CODE),
    state: stubReasonState(),
    intent: makeIntent([CLEAR_DRAG]),
  },
  {
    name: "a release after a text selection only clears the drag",
    gesture: makeMouseUp(SIGN, { textSelected: true }),
    state: stubReasonState(),
    intent: makeIntent([CLEAR_DRAG]),
  },
];

describe("deriveRowIntent on a line", () => {
  it.each(LINE_CASES)("$name", ({ gesture, state, intent }) => {
    expect(deriveRowIntent(gesture, state)).toEqual(intent);
  });
});

describe("deriveRowIntent on a reason row", () => {
  it.each(REASON_CASES)("$name", ({ gesture, state, intent }) => {
    expect(deriveRowIntent(gesture, state)).toEqual(intent);
  });
});
