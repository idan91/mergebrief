import type { ComponentPropsWithRef, MouseEvent } from "react";
import type { ValueOf } from "types";
import clsx from "clsx";

import styles from "./Button.module.scss";

export const BUTTON_ELEMENTS = {
  BUTTON: "button",
  ANCHOR: "a",
} as const;
export type ButtonElement = ValueOf<typeof BUTTON_ELEMENTS>;

export const BUTTON_VARIANTS = {
  PRIMARY: "primary",
  SECONDARY: "secondary",
} as const;
export type ButtonVariant = ValueOf<typeof BUTTON_VARIANTS>;

export const BUTTON_SIZES = {
  SM: "sm",
  MD: "md",
} as const;
export type ButtonSize = ValueOf<typeof BUTTON_SIZES>;

export type ButtonBaseProps = {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** aria-disabled + interaction guard — never the native attribute. */
  disabled?: boolean;
  /** aria-busy + the same guard; the label swap is the call site's. */
  loading?: boolean;
};

export type ButtonAsButtonProps = {
  as?: typeof BUTTON_ELEMENTS.BUTTON;
} & ButtonBaseProps &
  Omit<ComponentPropsWithRef<"button">, "disabled">;

export type ButtonAsAnchorProps = {
  as: typeof BUTTON_ELEMENTS.ANCHOR;
  href: string;
} & ButtonBaseProps &
  ComponentPropsWithRef<"a">;

export type ButtonProps = ButtonAsButtonProps | ButtonAsAnchorProps;

function isAnchorProps(props: ButtonProps): props is ButtonAsAnchorProps {
  return props.as === BUTTON_ELEMENTS.ANCHOR;
}

type ButtonSharedProps<E extends HTMLElement> = ButtonBaseProps & {
  "aria-busy"?: ComponentPropsWithRef<"button">["aria-busy"] | undefined;
  "aria-disabled"?:
    | ComponentPropsWithRef<"button">["aria-disabled"]
    | undefined;
  className?: string | undefined;
  onClick?: ((event: MouseEvent<E>) => void) | undefined;
};

/** The whole shared surface — presentation attrs + the inert-state click
    guard — declared once; the per-element branches only pick the tag. */
function buttonAttributes<
  E extends HTMLElement,
  P extends ButtonSharedProps<E>,
>(props: P) {
  const {
    variant = BUTTON_VARIANTS.SECONDARY,
    size = BUTTON_SIZES.MD,
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
    const { as: Tag, ...anchorProps } = props;
    return <Tag {...buttonAttributes(anchorProps)} />;
  }
  const { as: element, type = "button", ...buttonProps } = props;
  void element;
  return <button {...buttonAttributes(buttonProps)} type={type} />;
}
