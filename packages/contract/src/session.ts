// The session payload's wire shapes: what a client receives from the session
// read, nothing more. One payload type covers both sides of materialization,
// a session's own rows and the carry-over verdicts held in memory, because
// they differ only in whether a subject has a row id yet; `materialized` is
// what tells them apart.
import type {
  AnchorStatus,
  ChangeGroupCategory,
  DispositionCarryStatus,
  DispositionDecision,
  DispositionEvidence,
  DispositionEvidenceStatus,
  DraftCommentSide,
  DraftCommentStatus,
  ReviewOutcome,
} from "persistence";
import type { CommentAnchorKind } from "types";
import type { AttentionItem } from "./attention";

/**
 * The span the carry-over row states: the Brief the work came from, and how
 * many pushes since. Null is a first-ever session and nothing else.
 */
export interface CarriedFromPayload {
  readonly sessionId: string;
  readonly headSha: string;
  /** Pushes between that Brief and this one; at least 1. */
  readonly revisions: number;
  /**
   * How much work carried, counted by the store off the carry markers and the
   * previous session's own rows, never off this session's row totals, which
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

export interface DraftCommentPayloadBase {
  /** The row holding this draft, the previous session's before materializing. */
  readonly id: string;
  readonly filePath: string;
  readonly body: string;
  readonly status: DraftCommentStatus;
  readonly anchorStatus: AnchorStatus | null;
}

export interface LineDraftCommentPayload extends DraftCommentPayloadBase {
  readonly kind: Extract<CommentAnchorKind, "line">;
  readonly side: DraftCommentSide;
  /** Present only when the range genuinely crosses sides. */
  readonly startSide?: DraftCommentSide;
  readonly startLine: number;
  readonly endLine: number;
}

export interface FileDraftCommentPayload extends DraftCommentPayloadBase {
  readonly kind: Extract<CommentAnchorKind, "file">;
}

export type DraftCommentPayload =
  | LineDraftCommentPayload
  | FileDraftCommentPayload;

export interface ReclassificationPayload {
  readonly changeGroupId: string;
  readonly category: ChangeGroupCategory;
}

export interface DispositionPayload {
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
