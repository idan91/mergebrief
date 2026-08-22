// The session read's wire shape, built from either side of materialization: a
// session's own rows, or the carry-over verdicts held in memory. The two
// differ only in whether a subject has a row id yet, so one payload type
// covers both and `materialized` is what tells them apart.
import {
  ReviewOutcome,
  type AnchorStatus,
  type CarriedWork,
  type DispositionCarryStatus,
  type ChangeGroupCategory,
  type DispositionDecision,
  type DispositionEvidence,
  type DispositionEvidenceKind,
  type DispositionEvidenceStatus,
  type DraftCommentSide,
  type DraftCommentStatus,
  type ReviewSessionSnapshot,
  type ReviewSessionView,
} from "persistence";
import type { Mutable } from "types";
import { deriveAttentionItems, type AttentionItem } from "./attention";

/**
 * The span the carry-over row states: the Brief the work came from, and how
 * many pushes since. Null is a first-ever session and nothing else.
 */
interface CarriedFromPayload {
  readonly sessionId: string;
  readonly headSha: string;
  /** Pushes between that Brief and this one; at least 1. */
  readonly revisions: number;
  /**
   * How much work carried, counted by the store off the carry markers and the
   * previous session's own rows — never off this session's row totals, which
   * the reviewer's later work would inflate. Zero is a previous session that
   * carried nothing, and the one case with no row to render.
   */
  readonly items: number;
}

export interface SessionPayload {
  /** False = no row exists; every list below is an in-memory verdict. */
  readonly materialized: boolean;
  readonly carriedFrom: CarriedFromPayload | null;
  readonly reviewOutcome: ReviewOutcome;
  readonly draftComments: readonly DraftCommentPayload[];
  readonly readMarks: readonly string[];
  readonly reclassifications: readonly ReclassificationPayload[];
  readonly dispositions: readonly DispositionPayload[];
  readonly submittedReviewIds: readonly string[];
  readonly attention: readonly AttentionItem[];
}

interface DraftCommentPayload {
  /** The row that holds this draft — the previous session's before materialization. */
  readonly id: string;
  readonly filePath: string;
  readonly side: DraftCommentSide;
  /** Present only when the range genuinely crosses sides. */
  readonly startSide?: DraftCommentSide;
  readonly startLine: number;
  readonly endLine: number;
  readonly body: string;
  readonly status: DraftCommentStatus;
  readonly anchorStatus: AnchorStatus | null;
}

interface ReclassificationPayload {
  readonly changeGroupId: string;
  readonly category: ChangeGroupCategory;
}

interface DispositionPayload {
  readonly id: string | null;
  readonly filePath: string;
  readonly attribute: string;
  readonly regionStart: number;
  readonly regionEnd: number;
  readonly decision: DispositionDecision;
  readonly reason: string | null;
  readonly carryStatus: DispositionCarryStatus | null;
  readonly evidenceStatus: DispositionEvidenceStatus | null;
  /** What the decision stands on; null on a dismissal or once it was lost. */
  readonly evidence: DispositionEvidence | null;
  readonly decidedAt: string;
}

/** The row fields a draft payload is shaped from, either side of materialization. */
interface DraftCommentSource {
  readonly id: bigint;
  readonly filePath: string;
  readonly side: DraftCommentSide;
  readonly startSide: DraftCommentSide | null;
  readonly startLine: number;
  readonly endLine: number;
  readonly body: string;
  readonly status: DraftCommentStatus;
  readonly anchorStatus: AnchorStatus | null;
}

function shapeDraftComment(row: DraftCommentSource): DraftCommentPayload {
  const comment: Mutable<DraftCommentPayload> = {
    id: String(row.id),
    filePath: row.filePath,
    side: row.side,
    startLine: row.startLine,
    endLine: row.endLine,
    body: row.body,
    status: row.status,
    anchorStatus: row.anchorStatus,
  };
  if (row.startSide !== null) {
    comment.startSide = row.startSide;
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

/** The lists a payload carries, before materialization is accounted for. */
type SessionWork = Omit<
  SessionPayload,
  "materialized" | "carriedFrom" | "attention"
>;

function shapeStoredWork(snapshot: ReviewSessionSnapshot): SessionWork {
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
 * row — the previous session's, which the copy points back at. A disposition
 * has no id: every operation that clears one addresses it by its anchor.
 */
function shapeCarriedWork(carried: CarriedWork): SessionWork {
  return {
    // No row means no stored verdict; the column's default is what a first
    // write would land on.
    reviewOutcome: ReviewOutcome.COMMENT,
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
 * `headIndex` is the CURRENT Brief's — the revision count is the distance to
 * the Brief the work carried from, which is what the carry-over row states.
 */
export function buildSessionPayload(
  view: ReviewSessionView,
  headIndex: number,
): SessionPayload {
  const source = view.session ?? view.carried;
  const from = view.carriedFrom;
  return {
    materialized: view.session !== undefined,
    carriedFrom:
      from === undefined
        ? null
        : {
            sessionId: String(from.sessionId),
            headSha: from.headSha,
            revisions: headIndex - from.headIndex,
            items: from.items,
          },
    ...(view.session === undefined
      ? shapeCarriedWork(view.carried)
      : shapeStoredWork(view.session)),
    attention: deriveAttentionItems(source),
  };
}
