import type { Disposition } from "@web/features/review/session";
import {
  isLineCommentAnchor,
  type ReviewComment,
} from "@web/features/review/utils";
import type { RiskFlag } from "../../../../utils/viewModel";

/**
 * The comments a group's card can need to render: those anchored on its own
 * chunks, PLUS any comment an addressed flag's evidence links, evidence may
 * point at a comment anchored in ANOTHER group, and the evidence label
 * resolves it by exact id. A superset of every lookup `riskEvidenceLabel`
 * can perform for this group's flags.
 */
export function selectGroupReviewComments(
  state: {
    dispositions: Record<string, Disposition>;
    reviewComments: ReviewComment[];
  },
  groupFlags: readonly RiskFlag[],
  groupChunkIds: ReadonlySet<string>,
  groupFiles: ReadonlySet<string>,
): ReviewComment[] {
  const linked = new Set<string>();
  for (const flag of groupFlags) {
    const disposition = state.dispositions[flag.id];
    if (
      disposition?.kind === "addressed" &&
      disposition.evidence?.commentId !== undefined
    ) {
      linked.add(disposition.evidence.commentId);
    }
  }
  return state.reviewComments.filter((comment) => {
    if (linked.has(comment.id)) {
      return true;
    }
    if (isLineCommentAnchor(comment.anchor)) {
      return groupChunkIds.has(comment.anchor.chunkId);
    }
    return groupFiles.has(comment.anchor.file);
  });
}
