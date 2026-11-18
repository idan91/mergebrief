import type { TFunction } from "i18next";
import type { TranslationKey } from "i18n";

import { hasUploadPlaceholder } from "@web/components/MarkdownTextarea/utils";
import type { UnresolvedItem } from "../../utils/state";
import {
  UnresolvedItemKinds,
  type UnresolvedItemKind,
} from "../../utils/types";
import type {
  AdvisoryGroup,
  SubmitGate,
  SubmitGateInputs,
  SubmitView,
  UnresolvedItemGroup,
} from "./types";

/** The advisory list's kinds, top to bottom: risk dispositions, then reading, then drafts. */
const UNRESOLVED_KIND_RANKS: Record<UnresolvedItemKind, number> = {
  [UnresolvedItemKinds.OPEN_RISK]: 0,
  [UnresolvedItemKinds.MISSING_EVIDENCE]: 1,
  [UnresolvedItemKinds.THIN_DISMISSAL]: 2,
  [UnresolvedItemKinds.UNREVIEWED_CORE]: 3,
  [UnresolvedItemKinds.UNREVIEWED_REMAINDER]: 4,
  [UnresolvedItemKinds.DRAFT_COMMENT]: 5,
};

const UNRESOLVED_GROUP_HEADINGS: Record<UnresolvedItemKind, TranslationKey> = {
  [UnresolvedItemKinds.OPEN_RISK]: "review.submit.groupOpenRisk",
  [UnresolvedItemKinds.MISSING_EVIDENCE]: "review.submit.groupMissingEvidence",
  [UnresolvedItemKinds.UNREVIEWED_CORE]: "review.submit.groupUnreviewedCore",
  [UnresolvedItemKinds.UNREVIEWED_REMAINDER]:
    "review.submit.groupUnreviewedRemainder",
  [UnresolvedItemKinds.DRAFT_COMMENT]: "review.submit.groupDraftComment",
  [UnresolvedItemKinds.THIN_DISMISSAL]: "review.submit.groupThinDismissal",
};

/** One group per kind present, in the list's kind order; items keep their order. */
export function groupUnresolvedItems(
  items: readonly UnresolvedItem[],
): UnresolvedItemGroup[] {
  const groups = new Map<UnresolvedItemKind, UnresolvedItem[]>();
  for (const item of items) {
    const group = groups.get(item.kind);
    if (group === undefined) {
      groups.set(item.kind, [item]);
    } else {
      group.push(item);
    }
  }

  return [...groups]
    .map(([kind, ofKind]) => ({ kind, items: ofKind }))
    .toSorted(
      (first, second) =>
        UNRESOLVED_KIND_RANKS[first.kind] - UNRESOLVED_KIND_RANKS[second.kind],
    );
}

/** The advisory list as rendered: a heading per kind, a kind label per row for assistive tech. */
export function buildAdvisoryGroups(
  t: TFunction,
  items: readonly UnresolvedItem[],
): AdvisoryGroup[] {
  return groupUnresolvedItems(items).map((group) => ({
    kind: group.kind,
    heading: t(UNRESOLVED_GROUP_HEADINGS[group.kind], {
      count: group.items.length,
    }),
    count: group.items.length,
    rows: group.items.map((item) => ({
      item,
      kindLabel: t(UNRESOLVED_GROUP_HEADINGS[item.kind], { count: 1 }),
    })),
  }));
}

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
