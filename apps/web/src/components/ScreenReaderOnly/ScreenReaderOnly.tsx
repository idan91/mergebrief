import type { ElementType, ReactNode } from "react";

export interface ScreenReaderOnlyProps {
  children: ReactNode;
  /** Element to render. Defaults to `span`. */
  as?: ElementType;
  /** Set when the text is an `aria-describedby` target. */
  id?: string;
}

/**
 * Visually hides content while keeping it available to screen readers,
 * via the global `.sr-only` utility.
 */
export function ScreenReaderOnly({
  children,
  as: Tag = "span",
  id,
}: ScreenReaderOnlyProps) {
  return (
    <Tag className="sr-only" id={id}>
      {children}
    </Tag>
  );
}
