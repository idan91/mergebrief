import type { Placement } from "@floating-ui/react";

/** The corner the panel grows from: the edge that touches the trigger, on the aligned side. */
export function deriveTransformOrigin(placement: Placement): string {
  const [side, alignment] = placement.split("-");
  const block = side === "top" ? "bottom" : "top";
  const inline = alignment === "start" ? "left" : "right";
  return `${block} ${inline}`;
}
