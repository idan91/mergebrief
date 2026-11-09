import type { ReactNode } from "react";

import type { WindowSlot } from "../../window-layout";

export interface CardSlotProps {
  slot: WindowSlot;
  buildCard: (index: number) => ReactNode;
  measureElement: (node: Element | null) => void;
}

/**
 * One card in its measured slot, after the spacer that holds the track above
 * it. The slot stays the fragment's second child whether or not the spacer
 * renders, so a spacer coming or going never remounts the card.
 */
export function CardSlot({ slot, buildCard, measureElement }: CardSlotProps) {
  const card = buildCard(slot.item.index);
  if (card === undefined) {
    return <div aria-hidden style={{ blockSize: slot.missingTrack }} />;
  }

  return (
    <>
      {slot.gapBefore > 0 ? (
        <div aria-hidden style={{ blockSize: slot.gapBefore }} />
      ) : null}
      <div data-index={slot.item.index} ref={measureElement} style={slot.style}>
        {card}
      </div>
    </>
  );
}
