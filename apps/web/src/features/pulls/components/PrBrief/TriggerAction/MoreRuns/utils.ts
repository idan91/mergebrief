import type { Placement } from "@floating-ui/react";

export interface AnchorEdges {
  readonly left: number;
  readonly right: number;
}

/**
 * The menu opens flush with the edge its anchor leans to: its start edge in
 * the viewport's left half, its end edge in the right half.
 */
export function deriveMenuPlacement(
  anchor: AnchorEdges,
  viewportWidth: number,
): Placement {
  const anchorCentre = (anchor.left + anchor.right) / 2;
  if (anchorCentre < viewportWidth / 2) {
    return "bottom-start";
  }
  return "bottom-end";
}
