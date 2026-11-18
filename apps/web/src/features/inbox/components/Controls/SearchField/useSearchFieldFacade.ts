import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";

import { isInsideOverlay } from "@web/utils/overlay-target";
import { isSuppressedSingleKey } from "@web/utils/single-key-shortcuts";
import { isTypingTarget } from "@web/utils/typingTarget";
import { shapeSearchText } from "../../../search";
import { SEARCH_DEBOUNCE_MS, SEARCH_FOCUS_KEY } from "./consts";
import {
  reconcileUrlText,
  recordWrite,
  startSearchField,
  typeText,
} from "./utils";

export interface SearchFieldActions {
  onSearch: (text: string) => void;
  /** The reviewer typed past a write whose list is still loading. */
  onDropPendingSearch: () => void;
}

/**
 * The field's own text, ahead of the URL while the reviewer types: a pause
 * writes it, Enter writes it at once, and the URL moving on its own (Clear,
 * Back) replaces it. Clear empties it whether or not the URL moved. A
 * keystroke drops the list still loading for older text. Escape empties
 * the field, then leaves it.
 */
export function useSearchFieldFacade(
  urlText: string,
  clearCount: number,
  { onSearch, onDropPendingSearch }: SearchFieldActions,
) {
  const inputRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  /** The text the running timer will write; absent while none runs. */
  const scheduledRef = useRef<string>(undefined);
  const [held, setHeld] = useState(() => startSearchField(urlText, clearCount));

  const state = reconcileUrlText(held, urlText, clearCount);
  if (state !== held) {
    setHeld(state);
  }

  useEffect(() => {
    function focusOnSlash(event: KeyboardEvent): void {
      if (event.key !== SEARCH_FOCUS_KEY || event.metaKey || event.ctrlKey) {
        return;
      }
      if (isTypingTarget(event.target) || isInsideOverlay(event.target)) {
        return;
      }
      if (isSuppressedSingleKey(event)) {
        return;
      }
      event.preventDefault();
      inputRef.current?.focus();
      inputRef.current?.select();
    }
    window.addEventListener("keydown", focusOnSlash);
    return () => window.removeEventListener("keydown", focusOnSlash);
  }, []);

  useEffect(() => () => clearTimeout(timerRef.current), []);

  // The URL replaced the text from outside: a pause still counting down
  // would write the older text back.
  useEffect(() => {
    const scheduled = scheduledRef.current;
    if (scheduled !== undefined && scheduled !== state.text) {
      clearTimeout(timerRef.current);
      scheduledRef.current = undefined;
    }
  }, [state.text]);

  function write(next: string): void {
    clearTimeout(timerRef.current);
    scheduledRef.current = undefined;
    const written = shapeSearchText(next);
    setHeld((previous) => recordWrite(previous, written));
    onSearch(written);
  }

  function change(event: ChangeEvent<HTMLInputElement>): void {
    const next = event.target.value;
    if (state.awaitsLanding) {
      onDropPendingSearch();
    }
    setHeld((previous) => typeText(previous, next));

    clearTimeout(timerRef.current);
    scheduledRef.current = next;
    timerRef.current = setTimeout(() => write(next), SEARCH_DEBOUNCE_MS);
  }

  function clear(): void {
    setHeld((previous) => typeText(previous, ""));
    write("");
    inputRef.current?.focus();
  }

  function pressKey(event: ReactKeyboardEvent<HTMLInputElement>): void {
    // Enter commits an IME candidate and Escape cancels one; neither is the field's yet.
    if (event.nativeEvent.isComposing) {
      return;
    }
    if (event.key === "Enter") {
      write(state.text);
      return;
    }
    if (event.key !== "Escape") {
      return;
    }
    if (state.text === "") {
      inputRef.current?.blur();
      return;
    }
    event.preventDefault();
    clear();
  }

  return { inputRef, text: state.text, change, clear, pressKey };
}
