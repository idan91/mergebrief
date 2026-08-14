import type { ComponentPropsWithRef, MouseEvent } from "react";
import type { ValueOf } from "types";
import clsx from "clsx";

import styles from "./IconButton.module.scss";

export const ICON_BUTTON_VARIANTS = {
  GHOST: "ghost",
  OUTLINED: "outlined",
} as const;
export type IconButtonVariant = ValueOf<typeof ICON_BUTTON_VARIANTS>;

export const ICON_BUTTON_SIZES = {
  SM: "sm",
  MD: "md",
  LG: "lg",
} as const;
export type IconButtonSize = ValueOf<typeof ICON_BUTTON_SIZES>;

export type IconButtonBaseProps = {
  /** Required accessible name; a caller-passed aria-label overrides it. */
  label: string;
  variant?: IconButtonVariant;
  /** sm 24px (default) / md 32px / lg 34px circle. */
  size?: IconButtonSize;
  /** aria-disabled + interaction guard — never the native attribute. */
  disabled?: boolean;
};

export type IconButtonProps = IconButtonBaseProps &
  Omit<ComponentPropsWithRef<"button">, "disabled">;

export function IconButton(props: IconButtonProps) {
  const {
    label,
    variant = ICON_BUTTON_VARIANTS.GHOST,
    size = ICON_BUTTON_SIZES.SM,
    disabled = false,
    "aria-disabled": ariaDisabled,
    "aria-label": ariaLabel,
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
      aria-label={ariaLabel ?? label}
      className={clsx(styles["iconButton"], className)}
      data-size={size}
      data-variant={variant}
      type={type}
      onClick={handleClick}
    />
  );
}
