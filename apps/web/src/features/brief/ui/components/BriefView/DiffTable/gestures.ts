import {
  type DragMode,
  DragModes,
  type LineRowState,
  type ReasonRowState,
  type RowEffect,
  RowEffects,
  type RowGesture,
  RowGestureKinds,
  type RowIntent,
  type RowKeyDown,
  type RowMouseDown,
  type RowMouseUp,
  type RowState,
  RowStateKinds,
  RowTargets,
} from "./types";

interface IntentFlags {
  preventDefault?: boolean;
  stopPropagation?: boolean;
}

const PREVENT_DEFAULT: IntentFlags = { preventDefault: true };
const CONSUME_KEY: IntentFlags = { stopPropagation: true };

const FINISH_EFFECTS: Record<DragMode, RowEffect> = {
  [DragModes.COMMENT]: RowEffects.COMMENT_RANGE,
  [DragModes.SELECT]: RowEffects.SELECT_RANGE,
};

type PressOrKey = RowKeyDown | RowMouseDown | RowMouseUp;

function shapeIntent(effects: RowEffect[], flags: IntentFlags = {}): RowIntent {
  return {
    effects,
    preventDefault: flags.preventDefault ?? false,
    stopPropagation: flags.stopPropagation ?? false,
  };
}

function shapeNoIntent(): RowIntent {
  return shapeIntent([]);
}

/**
 * What a diff row does for one gesture: the line numbers select, the sign
 * comments, the code text stays natively selectable, and a guest row with
 * a reason toggles that reason. The handlers read the DOM into the gesture
 * and the state, then run the effects in order.
 */
export function deriveRowIntent(
  gesture: RowGesture,
  state: RowState,
): RowIntent {
  if (gesture.kind === RowGestureKinds.MOUSE_ENTER) {
    return state.drag === undefined
      ? shapeNoIntent()
      : shapeIntent([RowEffects.MOVE_DRAG]);
  }
  if (state.kind === RowStateKinds.REASON) {
    return deriveReasonRowIntent(gesture, state);
  }

  return deriveLineIntent(gesture, state);
}

function deriveLineIntent(gesture: PressOrKey, state: LineRowState): RowIntent {
  if (gesture.kind === RowGestureKinds.KEY_DOWN) {
    return deriveLineKeyIntent(gesture, state);
  }
  if (gesture.kind === RowGestureKinds.MOUSE_DOWN) {
    return deriveLinePressIntent(gesture, state);
  }

  return deriveLineReleaseIntent(gesture, state);
}

function deriveLineKeyIntent(
  gesture: RowKeyDown,
  state: LineRowState,
): RowIntent {
  if (gesture.target === RowTargets.BUTTON) {
    return shapeNoIntent();
  }
  if (gesture.key === "Enter") {
    const onSelection = state.lineSelected && !state.reanchorArmed;
    return shapeIntent([
      onSelection ? RowEffects.COMMENT_SELECTION : RowEffects.COMMENT_RANGE,
    ]);
  }
  if (gesture.key === " ") {
    return shapeIntent(
      [resolveLineSpaceEffect(gesture, state)],
      PREVENT_DEFAULT,
    );
  }
  // The row owns Escape only while it has a selection to clear and no
  // composer is open, so the composer's own Escape and the screen's still
  // reach the window.
  const clearsSelection =
    gesture.key === "Escape" && !state.composerOpen && state.hasSelection;

  return clearsSelection
    ? shapeIntent([RowEffects.CLEAR_SELECTION], CONSUME_KEY)
    : shapeNoIntent();
}

function resolveLineSpaceEffect(
  gesture: RowKeyDown,
  state: LineRowState,
): RowEffect {
  if (state.reanchorArmed) {
    return RowEffects.COMMENT_RANGE;
  }
  if (gesture.shift) {
    return RowEffects.EXTEND_SELECTION;
  }

  return RowEffects.SELECT_RANGE;
}

function deriveLinePressIntent(
  gesture: RowMouseDown,
  state: LineRowState,
): RowIntent {
  if (gesture.target === RowTargets.BUTTON) {
    return shapeNoIntent();
  }
  if (gesture.target === RowTargets.NUMBERS) {
    return shapeIntent(
      [
        RowEffects.DROP_TEXT_SELECTION,
        resolveNumbersPressEffect(gesture, state),
      ],
      PREVENT_DEFAULT,
    );
  }
  if (gesture.target === RowTargets.CODE) {
    return deriveCodePressIntent(state);
  }
  if (!state.commentable) {
    return shapeNoIntent();
  }

  // Dropping a stale text selection keeps it from tripping the release's
  // text-selection guard; inside the live selection the release comments
  // on all of it, so no drag begins.
  const effects: RowEffect[] = [RowEffects.DROP_TEXT_SELECTION];
  if (!state.lineSelected) {
    effects.push(RowEffects.BEGIN_COMMENT_DRAG);
  }

  return shapeIntent(effects, PREVENT_DEFAULT);
}

function resolveNumbersPressEffect(
  gesture: RowMouseDown,
  state: LineRowState,
): RowEffect {
  if (state.reanchorArmed) {
    return RowEffects.BEGIN_COMMENT_DRAG;
  }
  if (gesture.shift) {
    return RowEffects.EXTEND_SELECTION;
  }

  return RowEffects.BEGIN_SELECT_DRAG;
}

function deriveCodePressIntent(state: LineRowState): RowIntent {
  const effects: RowEffect[] = [];
  if (state.hasSelection) {
    effects.push(RowEffects.CLEAR_SELECTION);
  }
  if (state.split) {
    effects.push(RowEffects.MARK_SELECTING_SIDE);
  }

  return shapeIntent(effects);
}

function deriveLineReleaseIntent(
  gesture: RowMouseUp,
  state: LineRowState,
): RowIntent {
  if (state.drag !== undefined) {
    return shapeIntent([FINISH_EFFECTS[state.drag.mode]]);
  }
  // Composer entry is sign-only, so a double-click word-select on the code
  // never pops it; a text selection released over the sign is still text.
  if (gesture.target !== RowTargets.SIGN || gesture.textSelected) {
    return shapeNoIntent();
  }

  return shapeIntent([
    state.lineSelected
      ? RowEffects.COMMENT_SELECTION
      : RowEffects.COMMENT_RANGE,
  ]);
}

function deriveReasonRowIntent(
  gesture: PressOrKey,
  state: ReasonRowState,
): RowIntent {
  if (gesture.target === RowTargets.BUTTON) {
    return shapeNoIntent();
  }
  if (gesture.kind === RowGestureKinds.KEY_DOWN) {
    return deriveReasonKeyIntent(gesture, state);
  }
  if (gesture.kind === RowGestureKinds.MOUSE_DOWN) {
    return deriveReasonPressIntent(gesture, state);
  }

  return deriveReasonReleaseIntent(gesture, state);
}

function deriveReasonKeyIntent(
  gesture: RowKeyDown,
  state: ReasonRowState,
): RowIntent {
  if (gesture.key === "Enter") {
    return shapeIntent([RowEffects.TOGGLE_REASON], PREVENT_DEFAULT);
  }
  if (gesture.key === " ") {
    const effect = gesture.shift
      ? RowEffects.EXTEND_SELECTION
      : RowEffects.TOGGLE_REASON;
    return shapeIntent([effect], PREVENT_DEFAULT);
  }
  if (gesture.key !== "Escape") {
    return shapeNoIntent();
  }
  if (state.reasonOpen) {
    return shapeIntent([RowEffects.CLOSE_REASON], CONSUME_KEY);
  }
  if (!state.composerOpen && state.hasSelection) {
    return shapeIntent([RowEffects.CLEAR_SELECTION], CONSUME_KEY);
  }

  return shapeNoIntent();
}

function deriveReasonPressIntent(
  gesture: RowMouseDown,
  state: ReasonRowState,
): RowIntent {
  if (gesture.target === RowTargets.CODE) {
    return state.hasSelection
      ? shapeIntent([RowEffects.CLEAR_SELECTION])
      : shapeNoIntent();
  }
  if (gesture.target === RowTargets.SIGN) {
    return shapeIntent([RowEffects.DROP_TEXT_SELECTION], PREVENT_DEFAULT);
  }
  const effect = gesture.shift
    ? RowEffects.EXTEND_SELECTION
    : RowEffects.BEGIN_SELECT_DRAG;

  return shapeIntent([RowEffects.DROP_TEXT_SELECTION, effect], PREVENT_DEFAULT);
}

/**
 * A press and release on this row's own numbers is a click, which toggles;
 * a drag from elsewhere finishes as the drag it is, and a Shift click
 * already extended the selection on the press.
 */
function deriveReasonReleaseIntent(
  gesture: RowMouseUp,
  state: ReasonRowState,
): RowIntent {
  if (state.drag !== undefined && !state.drag.startedHere) {
    return shapeIntent([FINISH_EFFECTS[state.drag.mode]]);
  }
  const togglesReason =
    gesture.primary &&
    !gesture.shift &&
    gesture.target !== RowTargets.CODE &&
    !gesture.textSelected;
  if (!togglesReason) {
    return shapeIntent([RowEffects.CLEAR_DRAG]);
  }

  return shapeIntent([RowEffects.CLEAR_DRAG, RowEffects.TOGGLE_REASON]);
}
