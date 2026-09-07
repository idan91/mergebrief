// The session payload's wire shapes — what the FE receives, nothing more.
// The session read's wire shape, built from either side of materialization: a
// session's own rows, or the carry-over verdicts held in memory. The two
// differ only in whether a subject has a row id yet, so one payload type
// covers both and `materialized` is what tells them apart.
import type {
  ReviewOutcome,
  AnchorStatus,
  DispositionCarryStatus,
  ChangeGroupCategory,
  DispositionDecision,
  DispositionEvidence,
  DispositionEvidenceStatus,
  DraftCommentSide,
  DraftCommentStatus,
} from "persistence";
import { type AttentionItem } from "../attention";

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

export interface DraftCommentPayload {
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

/** The row fields a draft payload is shaped from, either side of materialization. */
export interface DraftCommentSource {
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

/** The lists a payload carries, before materialization is accounted for. */
export type SessionWork = Omit<
  SessionPayload,
  "materialized" | "carriedFrom" | "attention"
>;
