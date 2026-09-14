// A one-of-N lens control: native radios in a fieldset, so the browser
// supplies group semantics, one tab stop, and arrow-key movement. The inputs
// are visually hidden; the labels carry the chrome.
import { useId, useState } from "react";
import type { ValueOf } from "types/utils";

import { ScreenReaderOnly } from "@web/components/ScreenReaderOnly/ScreenReaderOnly";
import styles from "./SegmentedControl.module.scss";

/** Horizontal weight of the options. */
export const SegmentedDensities = {
  COMPACT: "compact",
  ROOMY: "roomy",
} as const;
export type SegmentedDensity = ValueOf<typeof SegmentedDensities>;

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  /**
   * Set when the option exists but cannot be chosen now. It stays FOCUSABLE
   * (`aria-disabled`, never `disabled`) so the reason is keyboard-reachable.
   */
  unavailableReason?: string | undefined;
}

export interface SegmentedControlProps<T extends string> {
  /**
   * Radio-group name. Grouping is DOCUMENT-scoped, so this is suffixed with
   * the instance id and two mounts cannot merge into one group.
   */
  name: string;
  /** The group's accessible name. Rendered visibly when `showLegend`. */
  legend: string;
  showLegend?: boolean | undefined;
  value: T;
  options: readonly SegmentedOption<T>[];
  onChange: (value: T) => void;
  className?: string | undefined;
  /** Horizontal weight; the two surfaces had different padding before. */
  density?: SegmentedDensity | undefined;
}

export function SegmentedControl<T extends string>({
  name,
  legend,
  showLegend = false,
  value,
  options,
  onChange,
  className,
  density = SegmentedDensities.COMPACT,
}: SegmentedControlProps<T>) {
  const groupId = useId();
  // Escape hides the focused option's reason until focus/pointer leaves and
  // re-enters (WAI-ARIA tooltip pattern).
  const [dismissedTip, setDismissedTip] = useState<string | null>(null);

  return (
    <fieldset className={className ?? styles["fieldset"]}>
      {showLegend ? (
        <legend className={styles["legend"]}>{legend}</legend>
      ) : (
        <ScreenReaderOnly as="legend">{legend}</ScreenReaderOnly>
      )}
      <div className={styles["group"]} data-density={density}>
        {options.map((option) => {
          const optionId = `${groupId}-${option.value}`;
          const reasonId = `${optionId}-reason`;
          const unavailable = option.unavailableReason !== undefined;
          return (
            <span
              className={styles["option"]}
              data-tip-dismissed={
                dismissedTip === option.value ? "true" : undefined
              }
              key={option.value}
              onPointerLeave={() => {
                setDismissedTip(null);
              }}
            >
              <input
                aria-describedby={unavailable ? reasonId : undefined}
                aria-disabled={unavailable || undefined}
                checked={value === option.value}
                className="sr-only"
                id={optionId}
                name={`${name}-${groupId}`}
                type="radio"
                value={option.value}
                onBlur={() => {
                  setDismissedTip(null);
                }}
                onChange={() => {
                  // Arrow keys can still select an unavailable option;
                  // refusing here reverts it on the next render.
                  if (!unavailable) onChange(option.value);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Escape" && unavailable) {
                    setDismissedTip(option.value);
                  }
                }}
              />
              <label
                className={styles["label"]}
                data-state={value === option.value ? "active" : undefined}
                data-unavailable={unavailable || undefined}
                htmlFor={optionId}
              >
                {option.label}
              </label>
              {unavailable ? (
                <span className={styles["tip"]} id={reasonId} role="tooltip">
                  {option.unavailableReason}
                </span>
              ) : null}
            </span>
          );
        })}
      </div>
    </fieldset>
  );
}
