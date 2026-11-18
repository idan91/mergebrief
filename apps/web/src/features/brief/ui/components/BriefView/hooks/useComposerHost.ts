import { useEffect } from "react";
import type { CommentAnchorKind } from "types/comments";

import { useReviewActions } from "@web/features/review/session";

/**
 * Marks this surface as one that shows the composer for `host`: once the
 * last such surface unmounts (a collapsed card, a raw diff toggled off, a
 * focus-mode group change), a composer it showed is dismissed rather than
 * left open off screen with the page shortcuts dead behind it.
 */
export function useComposerHost(
  anchorKind: CommentAnchorKind,
  host: string,
): void {
  const { holdComposerHost } = useReviewActions();

  useEffect(
    () => holdComposerHost(anchorKind, host),
    [anchorKind, holdComposerHost, host],
  );
}
