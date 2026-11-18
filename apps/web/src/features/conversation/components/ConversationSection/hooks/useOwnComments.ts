import { useEffect, useMemo, useRef } from "react";

import type { ReviewComment } from "@web/features/review/utils";
import type { PrConversation } from "../../../types";
import {
  reconcileOwnComments,
  type OwnCommentReconciliation,
} from "../../../utils/ownComments";

export interface OwnCommentsInput {
  conversation: PrConversation | undefined;
  localComments: readonly ReviewComment[];
  submittedReviewIds: readonly number[];
  /** Store flip for drafts the reconciliation proved posted. */
  markCommentsSubmitted: (ids: readonly string[]) => void;
}

/**
 * The reviewer's own threads in the fetched conversation. A local draft the
 * reconciliation proves is already on GitHub flips to submitted, server-backed
 * wins, so it can never be posted twice.
 */
export function useOwnComments(
  input: OwnCommentsInput,
): OwnCommentReconciliation | undefined {
  const { conversation, localComments, submittedReviewIds } = input;
  const { markCommentsSubmitted } = input;
  // Ids already flipped this mount, the reconciliation effect must never
  // loop (a flip changes localComments, which recomputes the reconcile).
  const flippedRef = useRef<Set<string>>(new Set());

  const reconciliation = useMemo(
    () =>
      conversation === undefined
        ? undefined
        : reconcileOwnComments(
            localComments,
            conversation.threads,
            submittedReviewIds,
          ),
    [conversation, localComments, submittedReviewIds],
  );

  useEffect(() => {
    if (reconciliation === undefined) {
      return;
    }
    const ids = reconciliation.resurrectedDraftIds.filter(
      (id) => !flippedRef.current.has(id),
    );
    if (ids.length === 0) {
      return;
    }
    for (const id of ids) {
      flippedRef.current.add(id);
    }
    // These drafts ARE on GitHub.
    markCommentsSubmitted(ids);
  }, [markCommentsSubmitted, reconciliation]);

  return reconciliation;
}
