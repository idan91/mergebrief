import type { ElementType, ReactNode } from "react";

export interface ScreenReaderOnlyProps {
  children: ReactNode;
  /** Element to render. Defaults to `span`. */
  as?: ElementType;
}

/**
 * Visually hides content while keeping it available to screen readers,
 * via the global `.sr-only` utility.
 */
export function ScreenReaderOnly({
  children,
  as: Tag = "span",
}: ScreenReaderOnlyProps) {
  return <Tag className="sr-only">{children}</Tag>;
}
