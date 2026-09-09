import type { TranslationKey } from "i18n";

import type { AttentionItemKind } from "@web/features/review/session";
import type { CarriedItem } from "@web/features/review/utils";

/**
 * The operations this screen can run, by the id the server uses. The client
 * NEVER decides which operations clear which kind, `clearedBy` says that.
 * This map only answers "can the browser do that one, and what is it
 * called". An id absent here renders no control rather than a dead one.
 */
export const ATTENTION_ACTION_COPY = {
  "reanchor-draft-comment": "brief.carryOver.actionReanchor",
  "delete-draft-comment": "brief.carryOver.actionDeleteDraft",
  "address-risk": "brief.carryOver.actionAddress",
  "dismiss-risk": "brief.carryOver.actionDismiss",
} as const satisfies Record<string, TranslationKey>;

export type AttentionActionId = keyof typeof ATTENTION_ACTION_COPY;

const KIND_COPY: Record<AttentionItemKind, TranslationKey> = {
  "orphaned-anchor": "brief.carryOver.kindOrphanedAnchor",
  "reopened-disposition": "brief.carryOver.kindReopenedDisposition",
  "missing-evidence": "brief.carryOver.kindMissingEvidence",
};

export function getKindCopyKey(item: CarriedItem): TranslationKey {
  return KIND_COPY[item.kind];
}

export function isRunnableAction(id: string): id is AttentionActionId {
  // `hasOwn`, not `in`: `clearedBy` is wire data and `in` answers true for
  // every prototype key, so a stray value would render a button labelled
  // with whatever `Object.prototype` holds.
  return Object.hasOwn(ATTENTION_ACTION_COPY, id);
}

/** An armed re-anchor's control is its own way out. */
export function getActionCopyKey(
  action: AttentionActionId,
  armed: boolean,
): TranslationKey {
  if (action === "reanchor-draft-comment" && armed) {
    return "brief.carryOver.actionReanchorArmed";
  }
  return ATTENTION_ACTION_COPY[action];
}

/** The runnable operations an item names, in the order the server named them. */
export function getRunnableActions(item: CarriedItem): AttentionActionId[] {
  return item.clearedBy.filter(isRunnableAction);
}
