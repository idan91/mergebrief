import { useCallback, type Ref, type RefCallback } from "react";

function assignRef<T>(ref: Ref<T> | undefined, node: T | null): void {
  if (typeof ref === "function") {
    ref(node);
    return;
  }
  if (ref) ref.current = node;
}

/** An element takes one ref, so a component that needs its own node shares the slot with the caller's ref. */
export function useMergedRef<T>(
  first: Ref<T> | undefined,
  second: Ref<T> | undefined,
): RefCallback<T> {
  return useCallback(
    (node: T | null) => {
      assignRef(first, node);
      assignRef(second, node);
    },
    [first, second],
  );
}
