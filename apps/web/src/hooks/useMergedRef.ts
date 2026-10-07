import { useCallback, type Ref, type RefCallback } from "react";

type RefCleanup = (() => void) | undefined;

function assignRef<T>(ref: Ref<T> | undefined, node: T | null): RefCleanup {
  if (typeof ref === "function") {
    const cleanup: unknown = ref(node);
    return typeof cleanup === "function" ? () => cleanup() : undefined;
  }
  if (ref) {
    ref.current = node;
  }
  return undefined;
}

/**
 * An element takes one ref, so a component that needs its own node shares
 * the slot with the caller's ref. A callback ref's cleanup is forwarded, so a
 * ref that owns an observer still tears it down on detach.
 */
export function useMergedRef<T>(
  first: Ref<T> | undefined,
  second: Ref<T> | undefined,
): RefCallback<T> {
  return useCallback(
    (node: T | null) => {
      const refs = [first, second];
      const cleanups = refs.map((ref) => assignRef(ref, node));
      if (node === null) {
        return undefined;
      }
      if (cleanups.every((cleanup) => cleanup === undefined)) {
        return undefined;
      }

      // React skips the null call when a cleanup is returned, so every ref
      // without one is detached here by hand.
      return () => {
        refs.forEach((ref, position) => {
          const cleanup = cleanups[position];
          if (cleanup === undefined) {
            assignRef(ref, null);
          } else {
            cleanup();
          }
        });
      };
    },
    [first, second],
  );
}
