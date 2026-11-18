import { shapeSearchText } from "../../../search";
import { OWN_WRITES_KEPT } from "./consts";
import type { SearchFieldState } from "./types";

export function startSearchField(urlText: string): SearchFieldState {
  return {
    text: urlText,
    seenUrlText: urlText,
    ownWrites: [],
    awaitsLanding: false,
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
 * The state once the URL holds `urlText`. The field's own write landing
 * keeps what the reviewer typed since and forgets that write with every
 * one before it; a change from outside replaces the text. The same state
 * comes back when the URL has not moved.
 */
export function reconcileUrlText(
  state: SearchFieldState,
  urlText: string,
): SearchFieldState {
  if (urlText === state.seenUrlText) {
    return state;
  }
  if (isOutsideChange(state, urlText)) {
    return startSearchField(urlText);
  }
  const landedAt = state.ownWrites.lastIndexOf(urlText);
  const ownWrites = state.ownWrites.slice(landedAt + 1);
  return {
    text: state.text,
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

/** The field wrote `written`; a text the URL already shows has nothing to land. */
export function recordWrite(
  state: SearchFieldState,
  written: string,
): SearchFieldState {
  if (written === state.seenUrlText) {
    return state;
  }
  const ownWrites = [...state.ownWrites, written].slice(-OWN_WRITES_KEPT);
  return { ...state, ownWrites, awaitsLanding: true };
}
