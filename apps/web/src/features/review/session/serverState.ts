import type {
  ChangeGroupCategory,
  CommentAnchorKinds,
  DiffSide,
  DispositionCarryStatus,
  DispositionDecision,
  ReviewOutcome,
} from "types";
import type { BriefViewModel } from "@web/features/brief/model";
import type { ReviewComment } from "../utils/comments";
import type { RiskEvidence } from "../utils/state";
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
  status: ReviewComment["status"];
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

export type SessionDraftComment =
  | SessionLineDraftComment
  | SessionFileDraftComment;

/** Held drafts this Brief has no chunk for; the submit route posts them. */
export type UnplacedDrafts = SessionDraftComment[];

export interface SessionDisposition {
  filePath: string;
  attribute: string;
  regionStart: number;
  regionEnd: number;
  decision: DispositionDecision;
  reason: string | null;
  evidence: { kind: RiskEvidence["kind"]; ref: string | null } | null;
  /** The carry-over verdict on this row; null on a fresh decision. */
  carryStatus: DispositionCarryStatus | null;
}

export interface SessionReclassification {
  changeGroupId: string;
  category: ChangeGroupCategory;
}

/**
 * The span the carry-over row states. Null is a first-ever session and
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
  carriedFrom: SessionCarriedFrom | null;
  attention: SessionAttentionItem[];
  reviewOutcome: ReviewOutcome;
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
    carriedFrom: null,
    attention: [],
    reviewOutcome: "comment",
    draftComments: [],
    readMarks: [],
    reclassifications: [],
    dispositions: [],
    submittedReviewIds: [],
  };
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
    reviewOutcome: payload.reviewOutcome,
    submittedReviewIds: payload.submittedReviewIds
      .map((id) => Number(id))
      .filter((id) => Number.isSafeInteger(id)),
    carriedFrom: payload.carriedFrom,
    attention: payload.attention,
  };
}
