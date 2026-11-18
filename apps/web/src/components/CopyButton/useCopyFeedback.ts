import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { COPY_FEEDBACK_RESET_MS } from "./consts";
import { type CopyFeedback, CopyStates, type CopyState } from "./types";

export interface UseCopyFeedbackInput {
  /** The text written to the clipboard, or a resolver run at copy time. */
  text: string | (() => string);
  /** Notified after a successful copy. */
  onCopy?: ((text: string) => void) | undefined;
}

/**
 * Writes `text` to the clipboard and holds the outcome for a moment, with
 * the polite announcement a control shows beside itself.
 */
export function useCopyFeedback({
  text,
  onCopy,
}: UseCopyFeedbackInput): CopyFeedback {
  const { t } = useTranslation();
  const [state, setState] = useState<CopyState>(CopyStates.IDLE);
  const resetTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(resetTimer.current), []);

  const copy = async () => {
    let next: CopyState = CopyStates.COPIED;
    const resolved = typeof text === "function" ? text() : text;
    try {
      await navigator.clipboard.writeText(resolved);
      onCopy?.(resolved);
    } catch {
      // Clipboard denied or insecure context, surfaced via the control's
      // own state, nothing else to recover.
      next = CopyStates.FAILED;
    }
    setState(next);
    window.clearTimeout(resetTimer.current);
    resetTimer.current = window.setTimeout(
      () => setState(CopyStates.IDLE),
      COPY_FEEDBACK_RESET_MS,
    );
  };

  const announcementByState: Record<CopyState, string> = {
    [CopyStates.IDLE]: "",
    [CopyStates.COPIED]: t("shell.copied"),
    [CopyStates.FAILED]: t("shell.copyFailed"),
  };

  return { state, copy, announcement: announcementByState[state] };
}
