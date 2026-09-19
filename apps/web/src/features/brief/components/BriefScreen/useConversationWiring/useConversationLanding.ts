// The digest-to-diff jump: one landing chain at a time, cancelled by a fresh
// jump, a brief switch, or the user's own input.
import { useCallback, useEffect, useMemo, useRef } from "react";

import { LANDING_FLASH_MS, LANDING_POLL_FRAMES } from "./consts";
import type {
  JumpToChunkFromConversation,
  LandingContext,
  UseConversationLandingInput,
} from "./types";
import { armLandingAbort, landOnChunkCard, landOnTargetRow } from "./utils";

interface PendingFlash {
  el: HTMLElement;
  timer: number;
}

export function useConversationLanding(
  input: UseConversationLandingInput,
): JumpToChunkFromConversation {
  const { briefId, jumpToChunk, cancelChunkScroll, ensureChunkOpen } = input;

  // Restart the flash on repeated jumps by dropping the attribute for a
  // frame; replace the old timer so it cannot cut the new flash short.
  const flashTimerRef = useRef<PendingFlash | null>(null);
  const flashTarget = useCallback((target: HTMLElement) => {
    const pending = flashTimerRef.current;
    if (pending !== null) {
      window.clearTimeout(pending.timer);
      pending.el.removeAttribute("data-conversation-flash");
      flashTimerRef.current = null;
    }
    target.removeAttribute("data-conversation-flash");
    window.requestAnimationFrame(() => {
      target.setAttribute("data-conversation-flash", "");
      flashTimerRef.current = {
        el: target,
        timer: window.setTimeout(() => {
          target.removeAttribute("data-conversation-flash");
          flashTimerRef.current = null;
        }, LANDING_FLASH_MS),
      };
    });
  }, []);

  // A stale loop could steal focus onto a same-id element of the NEXT brief:
  // this hook's host no longer remounts per brief, so a brief switch cancels.
  const frameRef = useRef<number | null>(null);
  const removeAbortRef = useRef<(() => void) | null>(null);
  const cancelLanding = useCallback(() => {
    if (frameRef.current !== null) {
      window.cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
    removeAbortRef.current?.();
    removeAbortRef.current = null;
  }, []);
  useEffect(() => cancelLanding, [briefId, cancelLanding]);

  const context = useMemo<LandingContext>(
    () => ({ frameRef, flashTarget, cancelChunkScroll }),
    [cancelChunkScroll, flashTarget],
  );

  return useCallback<JumpToChunkFromConversation>(
    (chunkId, target, behavior = "smooth") => {
      cancelLanding();
      // A row target only renders on an open card.
      ensureChunkOpen(chunkId);
      removeAbortRef.current = armLandingAbort(cancelLanding);

      // No row to find, an aggregated bot or a resolved one: the card it is.
      if (target === undefined) {
        jumpToChunk(chunkId, behavior);
        frameRef.current = window.requestAnimationFrame(() => {
          landOnChunkCard(context, chunkId, LANDING_POLL_FRAMES);
        });
        return;
      }

      // Instant coarse jump, which expands the chunk, then settle on the row.
      jumpToChunk(chunkId, "auto");
      frameRef.current = window.requestAnimationFrame(() => {
        landOnTargetRow(context, chunkId, target, LANDING_POLL_FRAMES);
      });
    },
    [cancelLanding, context, ensureChunkOpen, jumpToChunk],
  );
}
