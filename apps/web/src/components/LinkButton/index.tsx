import type { ComponentPropsWithRef, MouseEvent } from "react";
import clsx from "clsx";

import styles from "./LinkButton.module.scss";

export type LinkButtonBaseProps = {
  /** aria-disabled + interaction guard, never the native attribute. */
  disabled?: boolean;
};

export type LinkButtonProps = LinkButtonBaseProps &
  Omit<ComponentPropsWithRef<"button">, "disabled">;

/**
 * Inline text action: "text that acts" takes its context's font, so there
 * are no variant or size axes. Disclosure state (`aria-expanded`) rides
 * rest-spread.
 */
export function LinkButton(props: LinkButtonProps) {
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
      className={clsx(styles["linkButton"], className)}
      type={type}
      onClick={handleClick}
    />
  );
}
