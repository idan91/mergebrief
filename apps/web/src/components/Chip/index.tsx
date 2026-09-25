import type { ComponentPropsWithRef, MouseEvent } from "react";
import type { ValueOf } from "types/utils";
import clsx from "clsx";

import { Icon } from "../Icon";
import { IconNames, IconSizes } from "../Icon/types";
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
  MUTED: "muted",
} as const;
export type ChipTone = ValueOf<typeof ChipTones>;

/** A filter chip is a control the reviewer presses; a fact chip states one thing about a row. */
export const ChipVariants = {
  FILTER: "filter",
  FACT: "fact",
} as const;
export type ChipVariant = ValueOf<typeof ChipVariants>;

export type ChipBaseProps = {
  tone?: ChipTone;
  variant?: ChipVariant;
};

export type ChipAsButtonProps = {
  as?: typeof ChipElements.BUTTON;
  /** Controlled toggle state → aria-pressed; never inferred from clicks. */
  pressed?: boolean;
  /** aria-disabled + interaction guard; never the native attribute. */
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
    const {
      as: Tag,
      tone = ChipTones.NEUTRAL,
      variant = ChipVariants.FILTER,
      className,
      ...rest
    } = props;
    return (
      <Tag
        {...rest}
        className={clsx(styles["chip"], className)}
        data-tone={tone}
        data-variant={variant}
      />
    );
  }

  const {
    as: element = ChipElements.BUTTON,
    tone = ChipTones.NEUTRAL,
    variant = ChipVariants.FILTER,
    pressed,
    disabled = false,
    "aria-disabled": ariaDisabled,
    className,
    children,
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
      data-variant={variant}
      type={type}
      onClick={handleClick}
    >
      {pressed ? <Icon name={IconNames.CHECK} size={IconSizes.SM} /> : null}
      {children}
    </Tag>
  );
}
