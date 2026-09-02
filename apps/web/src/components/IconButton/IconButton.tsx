import type { Placement } from "@floating-ui/react";
import type { ComponentPropsWithRef, MouseEvent } from "react";
import { useState } from "react";
import type { ValueOf } from "types";
import clsx from "clsx";

import { useMergedRef } from "@web/hooks/useMergedRef";
import { Callout } from "../Callout/Callout";
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
  /** Required accessible name; a caller-passed aria-label overrides it. */
  label: string;
  variant?: IconButtonVariant;
  /** sm 24px (default) / md 32px / lg 34px circle. */
  size?: IconButtonSize;
  /** Width follows the content (labeled icon, e.g. "↳ g1"); height keeps the size. */
  autoWidth?: boolean;
  /** aria-disabled + interaction guard — never the native attribute. */
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
    ref,
    type = "button",
    ...rest
  } = props;
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const [calloutOpen, setCalloutOpen] = useState(false);
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
          if (callout !== undefined) setCalloutOpen(false);
          onBlur?.(event);
        }}
        onClick={handleClick}
        onFocus={(event) => {
          if (callout !== undefined) setCalloutOpen(true);
          onFocus?.(event);
        }}
        onPointerEnter={(event) => {
          if (callout !== undefined) setCalloutOpen(true);
          onPointerEnter?.(event);
        }}
      />
      {callout !== undefined && calloutOpen && anchor ? (
        <Callout
          anchor={anchor}
          compact
          fit
          placement={callout}
          onClose={() => setCalloutOpen(false)}
        >
          <Callout.Title>{ariaLabel ?? label}</Callout.Title>
        </Callout>
      ) : null}
    </>
  );
}
