import type { ComponentPropsWithRef, MouseEvent } from "react";
import clsx from "clsx";

import styles from "./ToolbarButton.module.scss";
import { ToolbarButtonVariants, type ToolbarButtonVariant } from "./types";

export type ToolbarButtonBaseProps = {
  /** aria-disabled + interaction guard, never the native attribute. */
  disabled?: boolean;
  /** Boxed (default) carries its own edge; ghost sits on a strip that already has one. */
  variant?: ToolbarButtonVariant | undefined;
};

export type ToolbarButtonProps = ToolbarButtonBaseProps &
  Omit<ComponentPropsWithRef<"button">, "disabled">;

/**
 * The toolbar pressed/disclosure trigger skin.
 * `aria-pressed` / `aria-expanded` are call-site state riding rest-spread.
 */
export function ToolbarButton(props: ToolbarButtonProps) {
  const {
    disabled = false,
    variant = ToolbarButtonVariants.BOXED,
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
      className={clsx(styles["toolbarButton"], className)}
      data-variant={variant}
      type={type}
      onClick={handleClick}
    />
  );
}
