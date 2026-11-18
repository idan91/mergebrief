import type { ReactNode } from "react";

import type { GroupWindow } from "../useGroupWindow";
import { deriveWindowSlots } from "../window-layout";
import { CardSlot } from "./CardSlot";

export interface WindowedCardsProps {
  window: GroupWindow;
  /** The card at a list index, or undefined where the list has no card. */
  buildCard: (index: number) => ReactNode;
}

/** A window's cards in normal flow, each in its own slot between sibling spacers. */
export function WindowedCards({ window, buildCard }: WindowedCardsProps) {
  const { slots, trailing } = deriveWindowSlots(
    window.items,
    window.scrollMargin,
    window.totalSize,
    window.viewportTop,
  );

  return (
    <>
      {slots.map((slot) => (
        <CardSlot
          key={slot.item.key}
          buildCard={buildCard}
          measureElement={window.measureElement}
          slot={slot}
        />
      ))}
      {trailing > 0 ? (
        <div aria-hidden style={{ blockSize: trailing }} />
      ) : null}
    </>
  );
}
