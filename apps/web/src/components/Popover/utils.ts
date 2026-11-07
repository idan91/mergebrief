import type { Alignment, Placement, SideObject } from "@floating-ui/react";

import { POPOVER_VIEWPORT_PADDING_PX } from "./consts";

const ALIGNED_INLINE: Record<Alignment, "left" | "right"> = {
  start: "left",
  end: "right",
};
const ALIGNED_BLOCK: Record<Alignment, "top" | "bottom"> = {
  start: "top",
  end: "bottom",
};

function isAlignment(value: string | undefined): value is Alignment {
  return value === "start" || value === "end";
}

/** The point the panel grows from: the edge that touches the trigger, on the aligned side. */
export function deriveTransformOrigin(placement: Placement): string {
  const [side, alignment] = placement.split("-");
  const aligned = isAlignment(alignment);
  if (side === "left" || side === "right") {
    const touching = side === "left" ? "right" : "left";
    const blockEdge = aligned ? ALIGNED_BLOCK[alignment] : "center";
    return `${blockEdge} ${touching}`;
  }

  const touching = side === "top" ? "bottom" : "top";
  const inlineEdge = aligned ? ALIGNED_INLINE[alignment] : "center";
  return `${touching} ${inlineEdge}`;
}

/** Keeps a panel clear of the pinned stack, which a flip would otherwise meet. */
export function deriveCollisionPadding(stackHeight: number): SideObject {
  return {
    top: stackHeight + POPOVER_VIEWPORT_PADDING_PX,
    right: POPOVER_VIEWPORT_PADDING_PX,
    bottom: POPOVER_VIEWPORT_PADDING_PX,
    left: POPOVER_VIEWPORT_PADDING_PX,
  };
}
