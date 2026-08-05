// A checkbox drawn in the app's own grammar (line, radius-sm, accent fill)
// rather than the platform's, which arrives at whatever size and blue the OS
// picked and ignores the token scale entirely.
//
// The native input is still the control — it is visually replaced, never
// swapped for a div: keyboard behaviour, form semantics, the checked state a
// screen reader reads, and `:focus-visible` all come free, and the drawn box
// is a sibling that reacts to `:checked`.
import type { ReactNode } from "react";

import styles from "./Checkbox.module.scss";

export interface CheckboxProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** The visible label; also the accessible name (it wraps the input). */
  children: ReactNode;
  disabled?: boolean | undefined;
  /** Marks selection for tests without reaching for the label text. */
  testId?: string | undefined;
}

export function Checkbox({
  checked,
  onChange,
  children,
  disabled,
  testId,
}: CheckboxProps) {
  return (
    <label className={styles["root"]} data-disabled={disabled || undefined}>
      <input
        checked={checked}
        className={styles["input"]}
        disabled={disabled}
        type="checkbox"
        {...(testId === undefined ? {} : { "data-testid": testId })}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span aria-hidden className={styles["box"]} />
      <span className={styles["label"]}>{children}</span>
    </label>
  );
}
