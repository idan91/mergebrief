import type { ComponentPropsWithRef, MouseEvent } from "react";
import type { ValueOf } from "types";
import clsx from "clsx";

import styles from "./RowButton.module.scss";

export const ROW_BUTTON_VARIANTS = {
  ROW: "row",
  CARD: "card",
} as const;
export type RowButtonVariant = ValueOf<typeof ROW_BUTTON_VARIANTS>;

export const ROW_BUTTON_DENSITIES = {
  FULL: "full",
  SLIM: "slim",
} as const;
export type RowButtonDensity = ValueOf<typeof ROW_BUTTON_DENSITIES>;

export type RowButtonBaseProps = {
  variant?: RowButtonVariant;
  /** Row-only axis; card ignores it. */
  density?: RowButtonDensity;
  /** aria-disabled + interaction guard — never the native attribute. */
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
    variant = ROW_BUTTON_VARIANTS.ROW,
    density = ROW_BUTTON_DENSITIES.FULL,
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
