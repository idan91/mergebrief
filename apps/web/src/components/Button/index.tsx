import type { ComponentPropsWithRef, MouseEvent } from "react";
import type { ValueOf } from "types/utils";
import clsx from "clsx";

import { AccessibleLink } from "../AccessibleLink";
import styles from "./Button.module.scss";

export const ButtonElements = {
  BUTTON: "button",
  ANCHOR: "a",
} as const;
/** @public */
export type ButtonElement = ValueOf<typeof ButtonElements>;

export const ButtonVariants = {
  /** The primary action of a view, one per view. */
  PRIMARY: "primary",
  SECONDARY: "secondary",
  QUIET: "quiet",
  /** Negative ink and edge on no fill: a destructive action, its weight carried by the dialog's words. */
  DANGER: "danger",
} as const;
export type ButtonVariant = ValueOf<typeof ButtonVariants>;

export const ButtonSizes = {
  SM: "sm",
  MD: "md",
} as const;
export type ButtonSize = ValueOf<typeof ButtonSizes>;

export type ButtonBaseProps = {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** aria-disabled + interaction guard; never the native attribute. */
  disabled?: boolean;
  /** aria-busy + the same guard; the label swap is the call site's. */
  loading?: boolean;
};

export type ButtonAsButtonProps = {
  as?: typeof ButtonElements.BUTTON;
} & ButtonBaseProps &
  Omit<ComponentPropsWithRef<"button">, "disabled">;

export type ButtonAsAnchorProps = {
  as: typeof ButtonElements.ANCHOR;
  href: string;
} & ButtonBaseProps &
  ComponentPropsWithRef<"a">;

export type ButtonProps = ButtonAsButtonProps | ButtonAsAnchorProps;

function isAnchorProps(props: ButtonProps): props is ButtonAsAnchorProps {
  return props.as === ButtonElements.ANCHOR;
}

type ButtonSharedProps<E extends HTMLElement> = ButtonBaseProps & {
  "aria-busy"?: ComponentPropsWithRef<"button">["aria-busy"] | undefined;
  "aria-disabled"?:
    | ComponentPropsWithRef<"button">["aria-disabled"]
    | undefined;
  className?: string | undefined;
  onClick?: ((event: MouseEvent<E>) => void) | undefined;
};

/** The whole shared surface; presentation attrs + the inert-state click
    guard; declared once; the per-element branches only pick the tag. */
function buttonAttributes<
  E extends HTMLElement,
  P extends ButtonSharedProps<E>,
>(props: P) {
  const {
    variant = ButtonVariants.SECONDARY,
    size = ButtonSizes.MD,
    disabled = false,
    loading = false,
    "aria-busy": ariaBusy,
    "aria-disabled": ariaDisabled,
    className,
    onClick,
    ...rest
  } = props;
  const handleClick = (event: MouseEvent<E>) => {
    if (disabled || loading) {
      event.preventDefault();
      return;
    }
    onClick?.(event);
  };
  return {
    ...rest,
    "aria-busy": loading ? true : ariaBusy,
    "aria-disabled": disabled ? true : ariaDisabled,
    className: clsx(styles["button"], className),
    "data-size": size,
    "data-variant": variant,
    onClick: handleClick,
  };
}

export function Button(props: ButtonProps) {
  if (isAnchorProps(props)) {
    const { as: element, ...anchorProps } = props;
    void element;
    // The announcement logic lives once; AccessibleLink owns the anchor.
    return <AccessibleLink {...buttonAttributes(anchorProps)} />;
  }
  const { as: element, type = "button", ...buttonProps } = props;
  void element;
  return <button {...buttonAttributes(buttonProps)} type={type} />;
}
