import { shapeSearchText } from "../../../search";
import { OWN_WRITES_KEPT } from "./consts";
import type { SearchFieldState } from "./types";

export function startSearchField(
  urlText: string,
  clearCount: number,
): SearchFieldState {
  return {
    text: urlText,
    seenUrlText: urlText,
    ownWrites: [],
    awaitsLanding: false,
    seenClearCount: clearCount,
  };
}

/**
 * Whether the URL's search text moved without this field writing it: Clear,
 * Back, a link. The URL landing on what the field holds, or on a write the
 * field made a moment ago, is the field's own change catching up.
 */
function isOutsideChange(state: SearchFieldState, urlText: string): boolean {
  const matchesField = urlText === shapeSearchText(state.text);
  return !matchesField && !state.ownWrites.includes(urlText);
}

/**
 * The state once the URL holds `urlText` and the filters were cleared
 * `clearCount` times. A Clear empties the field as a write of its own
 * would, since a search still loading never moved the URL for the field to
 * notice. The field's own write landing keeps what the reviewer typed
 * since and forgets that write with every one before it; a change from
 * outside replaces the text. The same state comes back when nothing moved.
 */
export function reconcileUrlText(
  state: SearchFieldState,
  urlText: string,
  clearCount: number,
): SearchFieldState {
  if (clearCount !== state.seenClearCount) {
    const cleared = recordWrite(typeText(state, ""), "");
    const counted = { ...cleared, seenClearCount: clearCount };
    return reconcileUrlText(counted, urlText, clearCount);
  }
  if (urlText === state.seenUrlText) {
    return state;
  }
  if (isOutsideChange(state, urlText)) {
    return startSearchField(urlText, clearCount);
  }
  const landedAt = state.ownWrites.lastIndexOf(urlText);
  const ownWrites = state.ownWrites.slice(landedAt + 1);
  return {
    ...state,
    seenUrlText: urlText,
    ownWrites,
    awaitsLanding: ownWrites.length > 0,
  };
}

/** A keystroke: the text moves on, and a list still loading for older text is no longer awaited. */
export function typeText(
  state: SearchFieldState,
  text: string,
): SearchFieldState {
  return { ...state, text, awaitsLanding: false };
}

/**
 * The field wrote `written`. A text the URL already shows has nothing to
 * land, and any earlier write was dropped on the way back to it.
 */
export function recordWrite(
  state: SearchFieldState,
  written: string,
): SearchFieldState {
  if (written === state.seenUrlText) {
    const settled = state.ownWrites.length === 0 && !state.awaitsLanding;
    return settled ? state : { ...state, ownWrites: [], awaitsLanding: false };
  }
  const ownWrites = [...state.ownWrites, written].slice(-OWN_WRITES_KEPT);
  return { ...state, ownWrites, awaitsLanding: true };
}
