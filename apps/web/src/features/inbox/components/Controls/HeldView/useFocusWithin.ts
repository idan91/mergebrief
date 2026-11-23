import { useState, type FocusEvent } from "react";

/** Whether focus sits inside an element, with the handlers that track it. */
export interface FocusWithin {
  focusWithin: boolean;
  handleFocus: () => void;
  handleBlur: (event: FocusEvent<HTMLElement>) => void;
}

/**
 * A window blur leaves the element focused in the document, so focus still
 * counts as inside until it moves to another element of the page.
 */
export function useFocusWithin(): FocusWithin {
  const [focusWithin, setFocusWithin] = useState(false);

  function handleFocus(): void {
    setFocusWithin(true);
  }

  function handleBlur(event: FocusEvent<HTMLElement>): void {
    const stillInside = event.currentTarget.contains(event.relatedTarget);
    if (!stillInside && document.hasFocus()) {
      setFocusWithin(false);
    }
  }

  return { focusWithin, handleFocus, handleBlur };
}
