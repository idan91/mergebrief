import type { ComponentPropsWithRef, MouseEvent } from "react";
import type { ValueOf } from "types/utils";
import clsx from "clsx";

import styles from "./RowButton.module.scss";

export const RowButtonVariants = {
  ROW: "row",
  /** A borderless row in a gate dialog's hairline list. */
  ITEM: "item",
} as const;
export type RowButtonVariant = ValueOf<typeof RowButtonVariants>;

export const RowButtonDensities = {
  FULL: "full",
  SLIM: "slim",
} as const;
export type RowButtonDensity = ValueOf<typeof RowButtonDensities>;

export type RowButtonBaseProps = {
  variant?: RowButtonVariant;
  /** Row-only axis; item ignores it. */
  density?: RowButtonDensity;
  /** aria-disabled + interaction guard; never the native attribute. */
  disabled?: boolean;
};

export type RowButtonProps = RowButtonBaseProps &
  Omit<ComponentPropsWithRef<"button">, "disabled">;

/**
 * Full-width row/card-as-button. Disclosure state (`aria-expanded`) is the
 * call site's and rides rest-spread.
 */
export function RowButton(props: RowButtonProps) {
  const {
    variant = RowButtonVariants.ROW,
    density = RowButtonDensities.FULL,
    disabled = false,
    "aria-disabled": ariaDisabled,
    className,
    onClick,
    type = "button",
    ...rest
  } = props;
  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    if (disabled) {
      event.preventDefault();
      return;
    }
    onClick?.(event);
  };
  return (
    <button
      {...rest}
      aria-disabled={disabled ? true : ariaDisabled}
      className={clsx(styles["rowButton"], className)}
      data-density={density}
      data-variant={variant}
      type={type}
      onClick={handleClick}
    />
  );
}
