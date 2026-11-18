import clsx from "clsx";
import type { ReactNode } from "react";

import type { ValueOf } from "types/utils";
import { AccessibleLink } from "../AccessibleLink";
import styles from "./Badge.module.scss";

export const BadgeColors = {
  NEUTRAL: "neutral",
  TEXT: "text",
  VIOLET: "violet",
  AMBER: "amber",
  POSITIVE: "positive",
  NEGATIVE: "negative",
} as const;

export type BadgeColor = ValueOf<typeof BadgeColors>;

export interface BadgeProps {
  children: ReactNode;
  color?: BadgeColor;
  className?: string | undefined;
  /** Native tooltip / accessible expansion text. */
  title?: string | undefined;
  /** Extra `data-*` attributes, keyed WITHOUT the `data-` prefix. */
  dataset?: Readonly<Record<string, string | undefined>> | undefined;
  /** Makes the whole badge the link, opened in a new tab. */
  href?: string | undefined;
}

/**
 * A small label on a 12% tint of its colour, in its own case. Domain mapping
 * (a chunk's role, a file's status) lives in wrappers like RoleBadge, not here.
 */
export function Badge({
  children,
  color = BadgeColors.NEUTRAL,
  className,
  title,
  dataset,
  href,
}: BadgeProps) {
  const dataAttributes = Object.fromEntries(
    Object.entries(dataset ?? {}).map(([key, value]) => [`data-${key}`, value]),
  );
  const badgeClassName = clsx(styles["badge"], className);

  if (href !== undefined) {
    return (
      <AccessibleLink
        className={badgeClassName}
        data-color={color}
        href={href}
        target="_blank"
        title={title}
        {...dataAttributes}
      >
        {children}
      </AccessibleLink>
    );
  }
  return (
    <span
      className={badgeClassName}
      data-color={color}
      title={title}
      {...dataAttributes}
    >
      {children}
    </span>
  );
}
