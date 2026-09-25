// A checkbox drawn in the app's own grammar rather than the platform's. The
// native input is still the control, visually replaced, never swapped for a
// div, so keyboard behaviour, form semantics, the screen-reader checked state
// and `:focus-visible` all come free; the drawn box is a sibling reacting to
// `:checked`.
import { useEffect, useRef, type ReactNode } from "react";

import styles from "./Checkbox.module.scss";

export interface CheckboxProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** The visible label; also the accessible name (it wraps the input). */
  children: ReactNode;
  disabled?: boolean | undefined;
  /** A partial set: the control reads mixed and draws a dash. */
  indeterminate?: boolean | undefined;
  /** Marks selection for tests without reaching for the label text. */
  testId?: string | undefined;
}

export function Checkbox({
  checked,
  onChange,
  children,
  disabled,
  indeterminate = false,
  testId,
}: CheckboxProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  // Indeterminate is a DOM property, not an attribute; it is set by hand.
  useEffect(() => {
    if (inputRef.current !== null) {
      inputRef.current.indeterminate = indeterminate;
    }
  }, [indeterminate]);

  return (
    <label className={styles["root"]} data-disabled={disabled || undefined}>
      <input
        aria-checked={indeterminate ? "mixed" : undefined}
        checked={checked}
        className={styles["input"]}
        disabled={disabled}
        ref={inputRef}
        type="checkbox"
        {...(testId === undefined ? {} : { "data-testid": testId })}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span aria-hidden className={styles["box"]} />
      <span className={styles["label"]}>{children}</span>
    </label>
  );
}
