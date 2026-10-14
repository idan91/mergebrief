import {
  type ChangeGroupCategory,
  type CommentAnchorKinds,
  type DiffSide,
  type DispositionCarryStatus,
  type DispositionDecision,
  type DispositionEvidenceKind,
  type DraftCommentStatus,
  type ReviewOutcome,
  ReviewOutcomes,
} from "types";
import { UnknownValues, type UnknownValue } from "@web/utils/open-enum/types";
import type { BriefViewModel } from "@web/features/brief/model";
import type { SessionAttentionItem } from "./attention";
import { deriveInitialState, type ReviewSessionState } from "./store";
import {
  getChunkRegions,
  resolveDispositions,
  resolveDraftComments,
} from "./anchors";

export interface SessionDraftCommentBase {
  id: string;
  filePath: string;
  body: string;
  status: DraftCommentStatus | UnknownValue;
}

export interface SessionLineDraftComment extends SessionDraftCommentBase {
  kind: typeof CommentAnchorKinds.LINE;
  side: DiffSide;
  /** Present only when the range genuinely crosses sides. */
  startSide?: DiffSide;
  startLine: number;
  endLine: number;
}

export interface SessionFileDraftComment extends SessionDraftCommentBase {
  kind: typeof CommentAnchorKinds.FILE;
}

/** An anchor this bundle predates: never placed or edited, still posted. */
export interface SessionHeldDraftComment extends SessionDraftCommentBase {
  kind: UnknownValue;
}

export type SessionDraftComment =
  | SessionLineDraftComment
  | SessionFileDraftComment
  | SessionHeldDraftComment;

/** Held drafts this Brief has no chunk for; the submit route posts them. */
export type UnplacedDrafts = SessionDraftComment[];

export interface SessionEvidence {
  kind: DispositionEvidenceKind | UnknownValue;
  ref: string | null;
}

export interface SessionDisposition {
  filePath: string;
  attribute: string;
  regionStart: number;
  regionEnd: number;
  decision: DispositionDecision | UnknownValue;
  reason?: string;
  evidence?: SessionEvidence;
  /** The carry-over verdict on this row; absent on a fresh decision. */
  carryStatus?: DispositionCarryStatus;
}

export interface SessionReclassification {
  changeGroupId: string;
  category: ChangeGroupCategory | UnknownValue;
}

/**
 * The span the carry-over row states. Absent is a first-ever session and
 * nothing else, the row itself does not render.
 */
export interface SessionCarriedFrom {
  sessionId: string;
  headSha: string;
  /** Pushes between that Brief and this one; at least 1. */
  revisions: number;
  /** How much work carried, the receipt's count, never the session's total. */
  items: number;
}

/** The slice of the session read this bundle renders. */
export interface ReviewSessionPayload {
  /** False = no session row exists yet; every list is an in-memory verdict. */
  materialized: boolean;
  carriedFrom?: SessionCarriedFrom;
  attention: SessionAttentionItem[];
  reviewOutcome: ReviewOutcome | UnknownValue;
  draftComments: SessionDraftComment[];
  readMarks: string[];
  reclassifications: SessionReclassification[];
  dispositions: SessionDisposition[];
  submittedReviewIds: string[];
}

/** A session with no work in it, the shape a first-ever read returns. */
export function emptySessionPayload(): ReviewSessionPayload {
  return {
    materialized: false,
    attention: [],
    reviewOutcome: ReviewOutcomes.COMMENT,
    draftComments: [],
    readMarks: [],
    reclassifications: [],
    dispositions: [],
    submittedReviewIds: [],
  };
}

/** An outcome this bundle cannot submit starts unpicked, never defaulted. */
function resolveReviewOutcome(
  outcome: ReviewOutcome | UnknownValue,
): ReviewOutcome | undefined {
  if (outcome === UnknownValues.UNKNOWN) {
    return undefined;
  }
  return outcome;
}

/**
 * The store's initial state: the model's derived baseline with the server's
 * session laid over it. No payload (an unavailable session, or a Brief with
 * no session at all) is the baseline alone.
 */
export function sessionInitialState(
  model: BriefViewModel,
  payload: ReviewSessionPayload | undefined,
): ReviewSessionState {
  const base = deriveInitialState(model);
  if (payload === undefined) {
    return base;
  }
  const chunkRegions = getChunkRegions(model);
  const { reviewComments, unplacedDrafts } = resolveDraftComments(
    payload.draftComments,
    model,
  );
  const dominants = { ...base.dominants };
  const reclassifiedGroups = new Set<string>();
  for (const entry of payload.reclassifications) {
    if (entry.category === UnknownValues.UNKNOWN) {
      continue;
    }
    if (!(entry.changeGroupId in dominants)) {
      continue;
    }
    dominants[entry.changeGroupId] = entry.category;
    reclassifiedGroups.add(entry.changeGroupId);
  }
  return {
    dispositions: resolveDispositions(
      payload.dispositions,
      model,
      base.dispositions,
    ),
    dominants,
    reclassifiedGroups,
    reviewedChunks: new Set(
      payload.readMarks.filter((id) => chunkRegions.has(id)),
    ),
    reviewComments,
    unplacedDrafts,
    reviewOutcome: resolveReviewOutcome(payload.reviewOutcome),
    submittedReviewIds: payload.submittedReviewIds
      .map((id) => Number(id))
      .filter((id) => Number.isSafeInteger(id)),
    carriedFrom: payload.carriedFrom,
    attention: payload.attention,
  };
}
