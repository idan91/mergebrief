import type { Placement } from "@floating-ui/react";
import type { ComponentPropsWithRef, MouseEvent } from "react";
import { useState } from "react";
import type { ValueOf } from "types/utils";
import clsx from "clsx";

import { useMergedRef } from "@web/hooks/useMergedRef";
import { Callout } from "../Callout/Callout";
import { useCalloutHover } from "../Callout/useCalloutHover";
import styles from "./IconButton.module.scss";

export const IconButtonVariants = {
  GHOST: "ghost",
  OUTLINED: "outlined",
} as const;
export type IconButtonVariant = ValueOf<typeof IconButtonVariants>;

export const IconButtonSizes = {
  SM: "sm",
  MD: "md",
  LG: "lg",
} as const;
export type IconButtonSize = ValueOf<typeof IconButtonSizes>;

export type IconButtonBaseProps = {
  /**
   * Compact callout text and default accessible name. A caller-passed
   * aria-label overrides the button name only; the callout still shows this.
   */
  label: string;
  variant?: IconButtonVariant;
  /** sm 24px (default) / md 32px / lg 34px circle. */
  size?: IconButtonSize;
  /** Width follows the content (labeled icon, e.g. "↳ g1"); height keeps the size. */
  autoWidth?: boolean;
  /** aria-disabled plus an interaction guard, never the native attribute. */
  disabled?: boolean;
  /** Show the label in a compact callout on hover and focus, on this side. */
  callout?: Placement;
};

export type IconButtonProps = IconButtonBaseProps &
  Omit<ComponentPropsWithRef<"button">, "disabled">;

export function IconButton(props: IconButtonProps) {
  const {
    label,
    variant = IconButtonVariants.GHOST,
    size = IconButtonSizes.SM,
    autoWidth = false,
    disabled = false,
    callout,
    "aria-disabled": ariaDisabled,
    "aria-label": ariaLabel,
    className,
    onBlur,
    onClick,
    onFocus,
    onPointerEnter,
    onPointerLeave,
    ref,
    type = "button",
    ...rest
  } = props;
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const hover = useCalloutHover();
  const attachRef = useMergedRef(
    callout !== undefined ? setAnchor : undefined,
    ref,
  );

  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    if (disabled) {
      event.preventDefault();
      return;
    }
    onClick?.(event);
  };

  return (
    <>
      <button
        {...rest}
        aria-disabled={disabled ? true : ariaDisabled}
        aria-label={ariaLabel ?? label}
        className={clsx(styles["iconButton"], className)}
        data-size={size}
        data-variant={variant}
        data-width={autoWidth ? "auto" : undefined}
        ref={attachRef}
        type={type}
        onBlur={(event) => {
          if (callout !== undefined) {
            hover.close();
          }
          onBlur?.(event);
        }}
        onClick={handleClick}
        onFocus={(event) => {
          if (callout !== undefined) {
            hover.show();
          }
          onFocus?.(event);
        }}
        onPointerEnter={(event) => {
          if (callout !== undefined) hover.arm(event);
          onPointerEnter?.(event);
        }}
        onPointerLeave={(event) => {
          hover.disarm();
          onPointerLeave?.(event);
        }}
      />
      {callout !== undefined && hover.open && anchor ? (
        <Callout
          anchor={anchor}
          compact
          fit
          placement={callout}
          onClose={hover.close}
        >
          <Callout.Title>{label}</Callout.Title>
        </Callout>
      ) : null}
    </>
  );
}
