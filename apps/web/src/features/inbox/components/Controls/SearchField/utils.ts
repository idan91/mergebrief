import { shapeSearchText } from "../../../search";
import type { SearchTextOverride } from "../../../types";
import { OWN_WRITES_KEPT } from "./consts";
import type { SearchFieldState } from "./types";

export function startSearchField(
  urlText: string,
  override: SearchTextOverride,
): SearchFieldState {
  return {
    text: urlText,
    seenUrlText: urlText,
    ownWrites: [],
    awaitsLanding: false,
    seenOverrideCount: override.count,
  };
}

/**
 * Whether the URL's search text moved with nothing here expecting it. The
 * URL landing on what the field holds, or on a text on its way there, is a
 * change the field already knows catching up.
 */
function isOutsideChange(state: SearchFieldState, urlText: string): boolean {
  const matchesField = urlText === shapeSearchText(state.text);
  return !matchesField && !state.ownWrites.includes(urlText);
}

/**
 * The state once the URL holds `urlText` under `override`. A new override
 * replaces the field's text and every write it had pending, since a Clear,
 * a Back or a link took their place and the URL may never show it. The
 * field's own write landing keeps what the reviewer typed since and forgets
 * that write with every one before it; a change from outside replaces the
 * text. The same state comes back when nothing moved.
 */
export function reconcileUrlText(
  state: SearchFieldState,
  urlText: string,
  override: SearchTextOverride,
): SearchFieldState {
  if (override.count !== state.seenOverrideCount) {
    // The override's text is remembered like a write, so its landing keeps
    // what is typed meanwhile. It is not awaited: it is not a search a
    // keystroke may drop.
    const alreadyShown = state.seenUrlText === override.text;
    const yielded: SearchFieldState = {
      text: override.text,
      seenUrlText: state.seenUrlText,
      ownWrites: alreadyShown ? [] : [override.text],
      awaitsLanding: false,
      seenOverrideCount: override.count,
    };
    return reconcileUrlText(yielded, urlText, override);
  }
  if (urlText === state.seenUrlText) {
    return state;
  }
  if (isOutsideChange(state, urlText)) {
    return startSearchField(urlText, override);
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
