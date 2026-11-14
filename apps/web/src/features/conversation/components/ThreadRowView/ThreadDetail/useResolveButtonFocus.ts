import { useCallback, useLayoutEffect, useRef } from "react";

export interface ResolveButtonFocus {
  /** The standalone resolve button's ref callback. */
  exposeButton: (element: HTMLButtonElement | null) => void;
  focusResolveAction: () => void;
}

/**
 * Holds the standalone resolve button's node. The button sits in the reply
 * row while writes are on and in a row of its own while they are off, so a
 * flip remounts it: focus resting on the old node moves to the new one.
 */
export function useResolveButtonFocus(): ResolveButtonFocus {
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const heldFocusRef = useRef(false);

  // React detaches a ref before it removes the node, and attaches the next
  // one in the same commit: the leaving node still reads as focused here.
  const exposeButton = useCallback((element: HTMLButtonElement | null) => {
    if (element === null) {
      const leaving = buttonRef.current;
      heldFocusRef.current =
        leaving !== null && document.activeElement === leaving;
      buttonRef.current = null;
      return;
    }

    buttonRef.current = element;
    if (heldFocusRef.current) {
      element.focus();
    }
  }, []);

  // Runs after this commit's refs attach, so a button that left with no
  // successor never hands its focus to one mounted later.
  useLayoutEffect(() => {
    heldFocusRef.current = false;
  });

  const focusResolveAction = useCallback(() => {
    buttonRef.current?.focus();
  }, []);

  return { exposeButton, focusResolveAction };
}
