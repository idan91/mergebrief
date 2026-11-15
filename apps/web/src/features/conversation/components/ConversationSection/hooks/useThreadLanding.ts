import { useEffect, useRef, useState } from "react";

import { prefersReducedMotion } from "@web/utils/motion";
import type { PrConversation } from "../../../types";
import type { DigestGroup } from "../../../utils/digest";
import type { DigestDisclosure } from "./useDigestDisclosure";
import { markSmoothScroll } from "../utils";

/** Frames to wait for the target's row to render before giving up. */
const LANDING_FRAME_BUDGET = 12;
const FLASH_MS = 1600;
const FLASH_ATTRIBUTE = "data-conversation-flash";

export interface ThreadLandingInput {
  /** The thread a link names, if any. */
  focusThreadId: number | undefined;
  open: boolean;
  conversation: PrConversation | undefined;
  digest: readonly DigestGroup[];
  revealThread: DigestDisclosure["revealThread"];
  /** Marks the landing's smooth scroll in flight, so a landing hold leaves it alone. */
  beginSmoothScroll: (() => () => void) | undefined;
}

/** Scrolls a thread's digest row to the centre, focuses it and flashes it. */
function landOnRow(
  row: HTMLElement,
  beginSmoothScroll: ThreadLandingInput["beginSmoothScroll"],
): void {
  // Reduced motion lands instantly; the flash is CSS-gated where styled.
  const smooth = !prefersReducedMotion();
  if (smooth && beginSmoothScroll !== undefined) {
    markSmoothScroll(beginSmoothScroll);
  }
  row.scrollIntoView({
    behavior: smooth ? "smooth" : "auto",
    block: "center",
  });
  (row.querySelector("button") ?? row).focus({ preventScroll: true });

  row.setAttribute(FLASH_ATTRIBUTE, "");
  window.setTimeout(() => row.removeAttribute(FLASH_ATTRIBUTE), FLASH_MS);
}

/**
 * Lands on the thread a link names once its row exists: reveals it, scrolls
 * to it, focuses and flashes it. The target is spent only after its row is
 * found and focused: a hidden row retries on refetch, and a completed target
 * never pulls focus from the reviewer again. Returns a way to land on the
 * same thread once more.
 */
export function useThreadLanding(input: ThreadLandingInput): () => void {
  const { focusThreadId, open, conversation, digest } = input;
  const { revealThread, beginSmoothScroll } = input;
  const landedThreadRef = useRef<number | undefined>(undefined);
  const [landingRequest, setLandingRequest] = useState(0);

  useEffect(() => {
    if (focusThreadId === undefined || !open || conversation === undefined) {
      return;
    }
    if (landedThreadRef.current === focusThreadId) {
      return;
    }
    revealThread(focusThreadId, digest);

    let frames = LANDING_FRAME_BUDGET;
    const land = () => {
      const row = document.querySelector<HTMLElement>(
        `[data-conversation-section-thread="${focusThreadId}"]`,
      );
      if (row !== null) {
        landedThreadRef.current = focusThreadId;
        landOnRow(row, beginSmoothScroll);
        return;
      }
      frames -= 1;
      if (frames > 0) {
        window.requestAnimationFrame(land);
      }
    };
    window.requestAnimationFrame(land);
  }, [
    conversation,
    digest,
    focusThreadId,
    open,
    landingRequest,
    beginSmoothScroll,
    revealThread,
  ]);

  return () => {
    landedThreadRef.current = undefined;
    setLandingRequest((count) => count + 1);
  };
}
