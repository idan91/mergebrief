// A checkbox drawn in the app's own grammar rather than the platform's. The
// native input is still the control, visually replaced, never swapped for a
// div, so keyboard behaviour, form semantics, the screen-reader checked state
// and `:focus-visible` all come free; the drawn box is a sibling reacting to
// `:checked`.
import { useEffect, useRef, type ReactNode, type RefObject } from "react";

import styles from "./Checkbox.module.scss";
import { useHydrationReplay } from "./useHydrationReplay";

export interface CheckboxProps {
  checked: boolean;
  /**
   * Boxes over one shared state must set it to `checked`, not flip it: ticks
   * made before hydration replay together in one commit.
   */
  onChange: (checked: boolean) => void;
  /** The visible label; also the accessible name (it wraps the input). */
  children?: ReactNode;
  /** The accessible name of a control with no visible label beside it. */
  ariaLabel?: string;
  /** The id of text beside the control that explains it. */
  describedBy?: string;
  disabled?: boolean | undefined;
  /** A partial set: the control reads mixed and draws a dash. */
  indeterminate?: boolean | undefined;
  /** Marks selection for tests without reaching for the label text. */
  testId?: string | undefined;
  /** The native input, for a caller that moves focus onto it. */
  inputRef?: RefObject<HTMLInputElement | null> | undefined;
}

export function Checkbox({
  checked,
  onChange,
  children,
  ariaLabel,
  describedBy,
  disabled,
  indeterminate = false,
  testId,
  inputRef,
}: CheckboxProps) {
  const ownRef = useRef<HTMLInputElement>(null);

  // Indeterminate is a DOM property, not an attribute; it is set by hand.
  useEffect(() => {
    if (ownRef.current !== null) {
      ownRef.current.indeterminate = indeterminate;
    }
  }, [indeterminate]);

  useHydrationReplay(ownRef, checked, onChange);

  function setInput(node: HTMLInputElement | null): void {
    ownRef.current = node;
    if (inputRef !== undefined) {
      inputRef.current = node;
    }
  }

  const labelled = children !== undefined;
  const variant = labelled ? undefined : "bare";

  return (
    <label className={styles["root"]} data-variant={variant}>
      <input
        aria-checked={indeterminate ? "mixed" : undefined}
        aria-describedby={describedBy}
        aria-label={ariaLabel}
        // Keeps a browser's restored form state from passing for a tick.
        autoComplete="off"
        checked={checked}
        className={styles["input"]}
        disabled={disabled}
        ref={setInput}
        type="checkbox"
        {...(testId === undefined ? {} : { "data-testid": testId })}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span aria-hidden className={styles["box"]} />
      {labelled ? <span className={styles["label"]}>{children}</span> : null}
    </label>
  );
}
