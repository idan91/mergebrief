import type { KeyboardEvent } from "react";

import { Dropdown } from "../Dropdown/Dropdown";
import { Icon } from "../Icon/Icon";
import { IconNames, IconSizes } from "../Icon/types";
import { ScreenReaderOnly } from "../ScreenReaderOnly/ScreenReaderOnly";
import styles from "./TimelinePicker.module.scss";

export interface TimelinePickerOption {
  readonly value: string;
  readonly label: string;
}

export interface TimelinePickerProps {
  /** The picker's name, read before the current option. */
  label: string;
  options: readonly TimelinePickerOption[];
  value: string;
  onValueChange: (value: string) => void;
  /** A navigator's own stepping keys, fired from the trigger. */
  onKeyDown?: (event: KeyboardEvent<HTMLButtonElement>) => void;
}

export function TimelinePicker({
  label,
  options,
  value,
  onValueChange,
  onKeyDown,
}: TimelinePickerProps) {
  const currentLabel =
    options.find((option) => option.value === value)?.label ?? "";
  // The current row is focused on open, so Enter there is a dismissal, not
  // a navigation; a native select fires no change for the same value.
  const chooseRevision = (next: string) => {
    if (next !== value) {
      onValueChange(next);
    }
  };

  return (
    <Dropdown value={value} onValueChange={chooseRevision}>
      <Dropdown.Trigger>
        {/* oxlint-disable-next-line house/no-raw-button -- the header slot's 32px mono control; no shared primitive has that shape */}
        <button
          className={styles["trigger"]}
          type="button"
          onKeyDown={onKeyDown}
        >
          <ScreenReaderOnly>{label} </ScreenReaderOnly>
          <span className={styles["current"]}>
            {options.map((option) => (
              <span
                aria-hidden="true"
                className={styles["ghost"]}
                key={option.value}
              >
                {option.label}
              </span>
            ))}
            <span className={styles["label"]}>{currentLabel}</span>
          </span>
          <Icon
            className={styles["caret"]}
            name={IconNames.CARET_DOWN}
            size={IconSizes.SM}
          />
        </button>
      </Dropdown.Trigger>
      <Dropdown.Content label={label}>
        {options.map((option) => (
          <Dropdown.Item key={option.value} value={option.value}>
            {option.label}
          </Dropdown.Item>
        ))}
      </Dropdown.Content>
    </Dropdown>
  );
}
