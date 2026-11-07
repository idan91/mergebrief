import { hasUploadPlaceholder } from "@web/components/MarkdownTextarea/utils";
import type { UnresolvedItem } from "../../utils/state";
import type { SubmitGate, SubmitGateInputs, SubmitView } from "./types";

/** An open with unresolved items stops on the advisory list first. */
export function pickEntryView(
  unresolvedItems: readonly UnresolvedItem[],
): SubmitView {
  return unresolvedItems.length > 0 ? "advisory" : "verdict";
}

/** The id of the text explaining why Submit is off; the first reason wins. */
export function deriveSubmitDescribedBy(
  blockedReason: string | undefined,
  staleUnacked: boolean,
  submitError: string | null,
): string | undefined {
  if (blockedReason !== undefined) {
    return "submit-modal-blocked";
  }
  if (staleUnacked) {
    return "submit-modal-stale-warning";
  }
  if (submitError !== null) {
    return "submit-modal-error";
  }
  return undefined;
}

/**
 * Ranks why Submit is off: the screen's override, then a pending upload, then
 * the live content rule, then an unacknowledged newer head. Both views rank
 * the same reasons, so the receipt's described-by id and refusal agree with
 * the verdict's; the receipt only swaps in copy that names Back.
 */
export function deriveSubmitGate({
  reviewComment,
  blockedReasonOverride,
  blockedReasonWith,
  staleUnacked,
  submitPending,
  submitError,
  submitNote,
  copy,
}: SubmitGateInputs): SubmitGate {
  // A placeholder still in the body would ship in place of its image.
  const uploadPending = hasUploadPlaceholder(reviewComment);
  const uploadReason = uploadPending ? copy.uploadPending : undefined;
  const blockedReason =
    blockedReasonOverride ?? uploadReason ?? blockedReasonWith?.(reviewComment);
  const disabled = submitPending || blockedReason !== undefined || staleUnacked;
  const describedBy = deriveSubmitDescribedBy(
    blockedReason,
    staleUnacked,
    submitError,
  );
  const verdictStatus = { blockedReason, error: submitError, note: submitNote };

  // The receipt holds neither the composer nor the stale checkbox, and an
  // upload landing while it shows settles only into a mounted composer, so
  // its reasons name Back as the way past them.
  const uploadBlocksReceipt =
    blockedReasonOverride === undefined && uploadPending;
  const receiptBlockedReason = uploadBlocksReceipt
    ? copy.receiptUploadPending
    : blockedReason;
  const receiptStatus = {
    ...verdictStatus,
    blockedReason: receiptBlockedReason,
  };
  const staleWarning = staleUnacked ? copy.staleWarning : undefined;
  const receiptStaleWarning = staleUnacked
    ? copy.receiptStaleWarning
    : undefined;

  return {
    disabled,
    describedBy,
    verdictStatus,
    receiptStatus,
    receiptStaleWarning,
    verdictRefusal: blockedReason ?? staleWarning,
    receiptRefusal: receiptBlockedReason ?? receiptStaleWarning,
  };
}
