import clsx from "clsx";
import type { ReactNode } from "react";

import type { ValueOf } from "types";
import styles from "./Badge.module.scss";

export const BadgeColors = {
  NEUTRAL: "neutral",
  TEXT: "text",
  BLUE: "blue",
  VIOLET: "violet",
  AMBER: "amber",
  POSITIVE: "positive",
  NEGATIVE: "negative",
} as const;

export type BadgeColor = ValueOf<typeof BadgeColors>;

export interface BadgeProps {
  children: ReactNode;
  color?: BadgeColor;
  fill?: boolean;
  className?: string | undefined;
  /** Native tooltip / accessible expansion text. */
  title?: string | undefined;
  /** Extra `data-*` attributes, keyed WITHOUT the `data-` prefix. */
  dataset?: Readonly<Record<string, string | undefined>> | undefined;
}

/**
 * @description Small bordered, uppercase tag chip. Generic label badge: `color`
 * picks a palette token, `fill` switches outline → tinted fill. Domain mapping
 * (e.g. chunk role) lives in wrappers like RoleBadge, not here.
 */
export function Badge({
  children,
  color = BadgeColors.NEUTRAL,
  fill = false,
  className,
  title,
  dataset,
}: BadgeProps) {
  const dataAttributes = Object.fromEntries(
    Object.entries(dataset ?? {}).map(([key, value]) => [`data-${key}`, value]),
  );
  return (
    <span
      className={clsx(styles["badge"], className)}
      data-color={color}
      data-fill={fill ? "" : undefined}
      title={title}
      {...dataAttributes}
    >
      {children}
    </span>
  );
}
