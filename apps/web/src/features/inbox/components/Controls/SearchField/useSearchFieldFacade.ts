import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type CompositionEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";

import { useFocusOnKey } from "../../../hooks/useFocusOnKey";
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
  /** An IME holds text the reviewer has not committed; no pause writes it. */
  const composingRef = useRef(false);
  const [held, setHeld] = useState(() => startSearchField(urlText, clearCount));

  const state = reconcileUrlText(held, urlText, clearCount);
  if (state !== held) {
    setHeld(state);
  }

  useFocusOnKey(SEARCH_FOCUS_KEY, inputRef, true);

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
    if (composingRef.current) {
      scheduledRef.current = undefined;
      return;
    }
    schedule(next);
  }

  function schedule(next: string): void {
    scheduledRef.current = next;
    timerRef.current = setTimeout(() => write(next), SEARCH_DEBOUNCE_MS);
  }

  function startComposing(): void {
    composingRef.current = true;
  }

  function endComposing(event: CompositionEvent<HTMLInputElement>): void {
    composingRef.current = false;
    clearTimeout(timerRef.current);
    schedule(event.currentTarget.value);
  }

  function clear(): void {
    setHeld((previous) => typeText(previous, ""));
    write("");
    inputRef.current?.focus();
  }

  function pressKey(event: ReactKeyboardEvent<HTMLInputElement>): void {
    // Enter commits an IME candidate and Escape cancels one; neither is the field's yet.
    if (event.nativeEvent.isComposing || composingRef.current) {
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

  return {
    inputRef,
    text: state.text,
    change,
    clear,
    pressKey,
    startComposing,
    endComposing,
  };
}
