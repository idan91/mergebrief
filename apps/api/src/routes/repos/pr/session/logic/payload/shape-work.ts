// Shape store rows and carried work into the payload's wire shapes.
// The session read's wire shape, built from either side of materialization: a
// session's own rows, or the carry-over verdicts held in memory. The two
// differ only in whether a subject has a row id yet, so one payload type
// covers both and `materialized` is what tells them apart.
import {
  ReviewOutcomes,
  CommentAnchorKinds,
  type CarriedWork,
  type DispositionEvidence,
  type DispositionEvidenceKind,
  type ReviewSessionSnapshot,
} from "persistence";
import type { Mutable } from "types";
import type {
  DraftCommentPayload,
  FileDraftCommentPayload,
  LineDraftCommentPayload,
} from "contract";
import type { DraftCommentSource, SessionWork } from "./types";

function shapeDraftComment(row: DraftCommentSource): DraftCommentPayload {
  const { anchor } = row;
  if (anchor.kind === CommentAnchorKinds.FILE) {
    const comment: FileDraftCommentPayload = {
      id: String(row.id),
      kind: CommentAnchorKinds.FILE,
      filePath: anchor.file,
      body: row.body,
      status: row.status,
      anchorStatus: row.anchorStatus,
    };
    return comment;
  }
  const comment: Mutable<LineDraftCommentPayload> = {
    id: String(row.id),
    kind: CommentAnchorKinds.LINE,
    filePath: anchor.file,
    side: anchor.side,
    startLine: anchor.startLine,
    endLine: anchor.endLine,
    body: row.body,
    status: row.status,
    anchorStatus: row.anchorStatus,
  };
  if (anchor.startSide !== undefined) {
    comment.startSide = anchor.startSide;
  }
  return comment;
}

/** The stored columns as the one shape the wire and the evaluation share. */
function shapeEvidence(
  kind: DispositionEvidenceKind | null,
  ref: string | null,
): DispositionEvidence | null {
  return kind === null ? null : { kind, ref };
}

export function shapeStoredWork(snapshot: ReviewSessionSnapshot): SessionWork {
  return {
    reviewOutcome: snapshot.session.reviewOutcome,
    draftComments: snapshot.draftComments.map(shapeDraftComment),
    readMarks: snapshot.readMarks.map((row) => row.chunkId),
    reclassifications: snapshot.reclassifications.map((row) => ({
      changeGroupId: row.changeGroupId,
      category: row.category,
    })),
    dispositions: snapshot.dispositions.map((row) => ({
      id: String(row.id),
      evidence: shapeEvidence(row.evidenceKind, row.evidenceRef),
      filePath: row.filePath,
      attribute: row.attribute,
      regionStart: row.regionStart,
      regionEnd: row.regionEnd,
      decision: row.decision,
      reason: row.reason,
      carryStatus: row.carryStatus,
      evidenceStatus: row.evidenceStatus,
      decidedAt: row.decidedAt.toISOString(),
    })),
    submittedReviewIds: snapshot.submittedReviews.map((row) =>
      String(row.githubReviewId),
    ),
  };
}

/**
 * The same lists from verdicts that are not rows yet. A draft still names a
 * row, the previous session's, which the copy points back at. A disposition
 * has no id: every operation that clears one addresses it by its anchor.
 */
export function shapeCarriedWork(carried: CarriedWork): SessionWork {
  return {
    // No row means no stored verdict; the column's default is what a first
    // write would land on.
    reviewOutcome: ReviewOutcomes.COMMENT,
    draftComments: carried.draftComments.map(shapeDraftComment),
    readMarks: [...carried.readMarks],
    reclassifications: carried.reclassifications.map((row) => ({
      changeGroupId: row.changeGroupId,
      category: row.category,
    })),
    dispositions: carried.dispositions.map((row) => ({
      id: null,
      filePath: row.filePath,
      attribute: row.attribute,
      regionStart: row.regionStart,
      regionEnd: row.regionEnd,
      decision: row.decision,
      reason: row.reason,
      carryStatus: row.carryStatus,
      evidenceStatus: row.evidenceStatus,
      evidence: row.evidence,
      decidedAt: row.decidedAt.toISOString(),
    })),
    submittedReviewIds: [],
  };
}

/**
 * `headIndex` is the CURRENT Brief's, the revision count is the distance to
 * the Brief the work carried from, which is what the carry-over row states.
 */
