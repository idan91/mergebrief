import type { ComponentPropsWithRef, MouseEvent } from "react";
import clsx from "clsx";

import styles from "./ToolbarButton.module.scss";

export type ToolbarButtonBaseProps = {
  /** aria-disabled + interaction guard, never the native attribute. */
  disabled?: boolean;
};

export type ToolbarButtonProps = ToolbarButtonBaseProps &
  Omit<ComponentPropsWithRef<"button">, "disabled">;

/**
 * The boxed toolbar pressed/disclosure trigger, a prop-less skin.
 * `aria-pressed` / `aria-expanded` are call-site state riding rest-spread.
 */
export function ToolbarButton(props: ToolbarButtonProps) {
  const {
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
      className={clsx(styles["toolbarButton"], className)}
      type={type}
      onClick={handleClick}
    />
  );
}
