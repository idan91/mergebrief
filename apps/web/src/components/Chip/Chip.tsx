import type { ComponentPropsWithRef, MouseEvent } from "react";
import type { ValueOf } from "types";
import clsx from "clsx";

import styles from "./Chip.module.scss";

export const CHIP_ELEMENTS = {
  BUTTON: "button",
  SPAN: "span",
} as const;
export type ChipElement = ValueOf<typeof CHIP_ELEMENTS>;

export const CHIP_TONES = {
  NEUTRAL: "neutral",
  WARNING: "warning",
} as const;
export type ChipTone = ValueOf<typeof CHIP_TONES>;

export type ChipBaseProps = {
  tone?: ChipTone;
};

export type ChipAsButtonProps = {
  as?: typeof CHIP_ELEMENTS.BUTTON;
  /** Controlled toggle state → aria-pressed; never inferred from clicks. */
  pressed?: boolean;
  /** aria-disabled + interaction guard — never the native attribute. */
  disabled?: boolean;
} & ChipBaseProps &
  Omit<ComponentPropsWithRef<"button">, "disabled" | "aria-pressed">;

export type ChipAsSpanProps = {
  as: typeof CHIP_ELEMENTS.SPAN;
} & ChipBaseProps &
  ComponentPropsWithRef<"span">;

export type ChipProps = ChipAsButtonProps | ChipAsSpanProps;

export function Chip(props: ChipProps) {
  if (props.as === CHIP_ELEMENTS.SPAN) {
    const { as: Tag, tone = CHIP_TONES.NEUTRAL, className, ...rest } = props;
    return (
      <Tag
        {...rest}
        className={clsx(styles["chip"], className)}
        data-tone={tone}
      />
    );
  }

  const {
    as: element = CHIP_ELEMENTS.BUTTON,
    tone = CHIP_TONES.NEUTRAL,
    pressed,
    disabled = false,
    "aria-disabled": ariaDisabled,
    className,
    onClick,
    type = "button",
    ...rest
  } = props;
  const Tag = element;
  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    if (disabled) {
      event.preventDefault();
      return;
    }
    onClick?.(event);
  };
  return (
    <Tag
      {...rest}
      aria-disabled={disabled ? true : ariaDisabled}
      aria-pressed={pressed}
      className={clsx(styles["chip"], className)}
      data-tone={tone}
      type={type}
      onClick={handleClick}
    />
  );
}
