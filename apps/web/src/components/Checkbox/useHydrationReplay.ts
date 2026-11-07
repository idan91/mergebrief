import { useLayoutEffect, useRef, type RefObject } from "react";

/**
 * Hydration keeps a tick the browser drew before it and fires no change, so
 * the first run hands that tick to the owner. It is a layout effect: a
 * passive one can run inside the next click's flush and report that click
 * twice.
 */
export function useHydrationReplay(
  inputRef: RefObject<HTMLInputElement | null>,
  checked: boolean,
  onChange: (checked: boolean) => void,
): void {
  const mounted = useRef(false);

  useLayoutEffect(() => {
    if (mounted.current) {
      return;
    }
    mounted.current = true;

    const node = inputRef.current;
    if (node === null || node.checked === checked) {
      return;
    }

    const ticked = node.checked;
    node.checked = checked;
    onChange(ticked);
  }, [checked, inputRef, onChange]);
}
