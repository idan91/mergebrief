import { useEffect, useState } from "react";

/** The value once it has held still for `delayMs`; the first value at once. */
export function useDebouncedValue<Value>(value: Value, delayMs: number): Value {
  const [settled, setSettled] = useState(value);

  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [value, delayMs]);

  return settled;
}
