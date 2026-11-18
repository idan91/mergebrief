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
import { dropLandedWrites, isOutsideChange, rememberOwnWrite } from "./utils";

/**
 * The field's own text, ahead of the URL while the reviewer types: a pause
 * writes it, Enter writes it at once, and the URL moving on its own (Clear,
 * Back) replaces it. Escape empties the field, then leaves it.
 */
export function useSearchFieldFacade(
  urlText: string,
  onSearch: (text: string) => void,
) {
  const inputRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [text, setText] = useState(urlText);
  const [seenUrlText, setSeenUrlText] = useState(urlText);
  const [ownWrites, setOwnWrites] = useState<readonly string[]>([]);

  if (urlText !== seenUrlText) {
    setSeenUrlText(urlText);
    setOwnWrites(dropLandedWrites(ownWrites, urlText));
    if (isOutsideChange(urlText, text, ownWrites)) {
      setText(urlText);
    }
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

  function write(next: string): void {
    clearTimeout(timerRef.current);
    const written = shapeSearchText(next);
    setOwnWrites((previous) => rememberOwnWrite(previous, written));
    onSearch(written);
  }

  function change(event: ChangeEvent<HTMLInputElement>): void {
    const next = event.target.value;
    setText(next);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => write(next), SEARCH_DEBOUNCE_MS);
  }

  function clear(): void {
    setText("");
    write("");
    inputRef.current?.focus();
  }

  function pressKey(event: ReactKeyboardEvent<HTMLInputElement>): void {
    if (event.key === "Enter") {
      write(text);
      return;
    }
    if (event.key !== "Escape") {
      return;
    }
    if (text === "") {
      inputRef.current?.blur();
      return;
    }
    event.preventDefault();
    clear();
  }

  return { inputRef, text, change, clear, pressKey };
}
