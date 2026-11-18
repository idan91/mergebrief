import { useEffect, useRef, type RefObject } from "react";

/**
 * A ref that always holds the latest rendered value — read it inside effects
 * and callbacks that must see THIS render's value without listing it as a
 * dependency (re-firing on every change would defeat the point).
 */
export function useLatestRef<T>(value: T): RefObject<T> {
  const ref = useRef(value);
  useEffect(() => {
    ref.current = value;
  });
  return ref;
}
