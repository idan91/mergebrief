import type { ComponentPropsWithRef, MouseEvent } from "react";
import type { ValueOf } from "types";
import clsx from "clsx";

import styles from "./Chip.module.scss";

export const ChipElements = {
  BUTTON: "button",
  SPAN: "span",
} as const;
/** @public */
export type ChipElement = ValueOf<typeof ChipElements>;

export const ChipTones = {
  NEUTRAL: "neutral",
  WARNING: "warning",
} as const;
export type ChipTone = ValueOf<typeof ChipTones>;

export type ChipBaseProps = {
  tone?: ChipTone;
};

export type ChipAsButtonProps = {
  as?: typeof ChipElements.BUTTON;
  /** Controlled toggle state → aria-pressed; never inferred from clicks. */
  pressed?: boolean;
  /** aria-disabled + interaction guard — never the native attribute. */
  disabled?: boolean;
} & ChipBaseProps &
  Omit<ComponentPropsWithRef<"button">, "disabled" | "aria-pressed">;

export type ChipAsSpanProps = {
  as: typeof ChipElements.SPAN;
} & ChipBaseProps &
  ComponentPropsWithRef<"span">;

export type ChipProps = ChipAsButtonProps | ChipAsSpanProps;

export function Chip(props: ChipProps) {
  if (props.as === ChipElements.SPAN) {
    const { as: Tag, tone = ChipTones.NEUTRAL, className, ...rest } = props;
    return (
      <Tag
        {...rest}
        className={clsx(styles["chip"], className)}
        data-tone={tone}
      />
    );
  }

  const {
    as: element = ChipElements.BUTTON,
    tone = ChipTones.NEUTRAL,
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
