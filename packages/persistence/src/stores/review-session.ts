// Tenant context filters every read and stamps every write. Reads never create sessions;
// first writes materialize them. Resolve parent ownership inside the same transaction
// and return Result errors for cross-tenant parents before any write.
import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  gte,
  inArray,
  isNotNull,
  lt,
  lte,
  or,
} from "drizzle-orm";
import {
  readBriefSessionFacts,
  type BriefSessionFacts,
} from "brief-core/artifact";
import type { Hop } from "brief-core/remap";
import { randomUUID } from "node:crypto";
import {
  AnchorStatuses,
  CommentAnchorKinds,
  DraftCommentStatuses,
} from "types/comments";
import { AnchorStates } from "types/generations";
import type { AppDrizzle } from "../db/handle";
import { brief } from "../schema/brief";
import { disposition } from "../schema/disposition";
import { hunkSpan } from "../schema/hunk-span";
import {
  isFileDraftCommentRow,
  isLineDraftCommentRow,
  reviewDraftComment,
  type LineDraftCommentRow,
} from "../schema/review-draft-comment";
import { reviewGroupReclassification } from "../schema/review-group-reclassification";
import { reviewReadMark } from "../schema/review-read-mark";
import { reviewSession } from "../schema/review-session";
import { reviewSubmittedReview } from "../schema/review-submitted-review";
import {
  assembleHops,
  evaluateCarryOver,
  NOTHING_CARRIED,
  type CarriedWork,
  type PreviousWork,
} from "./carry-over";
import { StoredIdsSchema } from "./artifact-store";
import type { RowScope } from "./scope";
import {
  ClaimStates,
  type BriefRowId,
  type ClaimState,
  type DraftAnchor,
  type LineDraftAnchor,
  type PullRequestRowId,
  type ReviewSessionId,
  type ReviewerId,
} from "../types";
import type { ChangeGroupCategory, ReviewOutcome } from "types/reviews";
import type {
  DispositionDecision,
  DispositionEvidence,
} from "types/dispositions";
import type { Result, ValueOf } from "types/utils";

// ---------------------------------------------------------------------------
// Errors, expected failures. Programmer errors still `throw`. Owned here
// rather than borrowed from `tenant.ts`, which composes this module.
// ---------------------------------------------------------------------------

export const ReviewSessionErrorCodes = {
  /** A write named a `brief` or `review_session` outside ctx's tenant. */
  PARENT_NOT_IN_TENANT: "parent-not-in-tenant",
  /**
   * The reviewer has already materialized a session on a NEWER Brief of this
   * PR, so this one is frozen. A newer Brief on its own never freezes
   * anything, that would reject writes mid-sentence every time the worker
   * generated one. Surfaces as the existing `pr-changed-since-read` (409).
   */
  SESSION_FROZEN: "session-frozen",
  /**
   * The Brief body will not yield its session facts. Never read as empty
   * facts: no flag firing would drop every carried decision silently.
   */
  BRIEF_UNREADABLE: "brief-unreadable",
  /** The session holds no draft by that id, its own or a carried source's. */
  DRAFT_NOT_FOUND: "draft-not-found",
  /** The draft is already on GitHub, so it no longer moves. */
  DRAFT_ALREADY_PUBLISHED: "draft-already-published",
  /** The draft's anchor points at no code in this Brief, so it cannot post. */
  DRAFT_ANCHOR_ORPHANED: "draft-anchor-orphaned",
  /** A publish attempt holds the draft and is still inside its lease. */
  DRAFT_PUBLISH_PENDING: "draft-publish-pending",
  /** A publish attempt held the draft past its lease without settling. */
  DRAFT_PUBLISH_IN_DOUBT: "draft-publish-in-doubt",
  /** The session already holds `MAX_SESSION_DRAFTS` unposted drafts. */
  DRAFT_LIMIT_REACHED: "draft-limit-reached",
  /**
   * A new read mark, reclassification or decision would hold more rows of
   * its kind than the Brief has Chunks, groups or flags.
   */
  SESSION_RECORD_LIMIT_REACHED: "session-record-limit-reached",
  /** A write meant only for a session that exists found none. */
  SESSION_NOT_FOUND: "session-not-found",
} as const;
export type ReviewSessionErrorCode = ValueOf<typeof ReviewSessionErrorCodes>;

export interface ReviewSessionError {
  readonly code: ReviewSessionErrorCode;
  readonly message: string;
}

/**
 * How many unposted drafts one session may hold. It bounds what a single
 * submit posts to GitHub: the 65th is refused when it is written, not at
 * submit, where the reviewer would have nowhere to put it.
 */
const MAX_SESSION_DRAFTS = 64;

/**
 * How long a publish attempt holds its drafts before the claim is in doubt.
 * Longer than the slowest Submit, so a live attempt is never judged lost.
 */
export const PUBLISH_CLAIM_LEASE_MS = 3 * 60 * 1000;

/** The claim columns a lease judgement reads. */
export interface ClaimStamp {
  readonly publishClaimedAt: Date | null;
}

/** Whether a draft is held by a publish attempt, and for how long. */
export function deriveClaimState(stamp: ClaimStamp, now: Date): ClaimState {
  if (stamp.publishClaimedAt === null) {
    return ClaimStates.UNCLAIMED;
  }
  const held = now.getTime() - stamp.publishClaimedAt.getTime();
  if (held < PUBLISH_CLAIM_LEASE_MS) {
    return ClaimStates.PENDING;
  }
  return ClaimStates.IN_DOUBT;
}

/** The refusal each claim state earns from a write; absent means it passes. */
type ClaimRefusals = Partial<Record<ClaimState, ReviewSessionErrorCode>>;

const CLAIMED_DRAFT_REFUSALS: ClaimRefusals = {
  [ClaimStates.PENDING]: ReviewSessionErrorCodes.DRAFT_PUBLISH_PENDING,
  [ClaimStates.IN_DOUBT]: ReviewSessionErrorCodes.DRAFT_PUBLISH_IN_DOUBT,
};

/** Deleting an in-doubt draft is the reviewer saying it is on GitHub. */
const DELETE_CLAIM_REFUSALS: ClaimRefusals = {
  [ClaimStates.PENDING]: ReviewSessionErrorCodes.DRAFT_PUBLISH_PENDING,
};

/**
 * Carries a refusal out of a transaction callback, so the transaction rolls
 * back; a refusal returned from the callback would commit.
 */
class SessionOperationRefusal extends Error {
  readonly refusal: ReviewSessionError;

  constructor(refusal: ReviewSessionError) {
    super(refusal.message);
    this.refusal = refusal;
  }
}

type Tx = Parameters<Parameters<AppDrizzle["transaction"]>[0]>[0];

/** A read that works inside a transaction or straight off the handle. */
type Reader = Tx | AppDrizzle;

/** What an operation does once its session is open and locked. */
type SessionStep<Value> = (
  tx: Tx,
  session: ReviewSessionRow,
) => Promise<SessionOperationResult<Value>>;

export type ReviewSessionRow = typeof reviewSession.$inferSelect;
type DraftCommentSqlRow = typeof reviewDraftComment.$inferSelect;
type HeldClaim = Pick<DraftCommentSqlRow, "publishClaim" | "publishClaimedAt">;
export type ReviewDraftCommentRow = Omit<
  DraftCommentSqlRow,
  "kind" | "filePath" | "side" | "startSide" | "startLine" | "endLine"
> & { readonly anchor: DraftAnchor };
export type ReviewReadMarkRow = typeof reviewReadMark.$inferSelect;
export type ReviewGroupReclassificationRow =
  typeof reviewGroupReclassification.$inferSelect;
export type ReviewSubmittedReviewRow =
  typeof reviewSubmittedReview.$inferSelect;
export type DispositionRow = typeof disposition.$inferSelect;

/** The session key, a Brief and the reviewer working against it. */
export interface ReviewSessionKey {
  readonly briefId: BriefRowId;
  readonly reviewerId: ReviewerId;
}

/** The reviewer marking a Chunk read, or unread with `read: false`. */
export interface ChunkReadInput {
  readonly chunkId: string;
  readonly read: boolean;
}

/** The reviewer's own category for a change group, overriding the Brief's. */
export interface GroupReclassificationInput {
  readonly changeGroupId: string;
  readonly category: ChangeGroupCategory;
}

/** Drafts GitHub now holds, and the review that wraps them when it has one. */
export interface PublishedDraftsInput {
  readonly draftIds: readonly bigint[];
  readonly githubReviewId?: bigint;
}

/** The drafts a publish attempt takes, each by its own or its source's id. */
export interface ClaimDraftsInput {
  readonly draftIds: readonly bigint[];
  /** The claim's time and the lease judgement's clock; defaults to now. */
  readonly now?: Date;
}

/** The claim token a publish attempt holds, and the rows it holds. */
export interface DraftClaim {
  readonly claim: string;
  readonly drafts: readonly ReviewDraftCommentRow[];
}

/** A claim whose drafts reached GitHub, and the review that wraps them. */
export interface SettleClaimInput {
  readonly claim: string;
  readonly githubReviewId?: bigint;
}

/** A claim whose drafts did not reach GitHub. */
export interface ReleaseClaimInput {
  readonly claim: string;
}

/** A decision on one risk flag, anchored by content coordinates. */
export interface DispositionInput {
  readonly filePath: string;
  readonly attribute: string;
  readonly regionStart: number;
  readonly regionEnd: number;
  readonly decision: DispositionDecision;
  /** Verbatim on the Receipt; null when the flag was addressed rather than dismissed. */
  readonly reason?: string | null;
  /** What an addressing decision points at; null on a dismissal. */
  readonly evidence?: DispositionEvidence | null;
}

/** A disposition's anchor, the only way a clearing operation names one. */
export type DispositionAnchor = Pick<
  DispositionInput,
  "filePath" | "attribute" | "regionStart" | "regionEnd"
>;

/**
 * The session and everything it owns, one read, no writes. Every list is
 * insertion-ordered by row id: an in-place UPDATE rewrites the heap tuple, so
 * an unordered read would permute the list after a status flip.
 */
export interface ReviewSessionSnapshot {
  readonly session: ReviewSessionRow;
  readonly draftComments: readonly ReviewDraftCommentRow[];
  readonly readMarks: readonly ReviewReadMarkRow[];
  readonly reclassifications: readonly ReviewGroupReclassificationRow[];
  readonly submittedReviews: readonly ReviewSubmittedReviewRow[];
  readonly dispositions: readonly DispositionRow[];
}

/** The receipt's count before materialization, every evaluated subject. */
function countPendingCarriedItems(carried: CarriedWork): number {
  return (
    carried.draftComments.length +
    carried.readMarks.length +
    carried.reclassifications.length +
    carried.dispositions.length
  );
}

/** The session a read carried in from, and the Brief it sat on. */
export interface CarriedFrom {
  readonly sessionId: ReviewSessionId;
  readonly headSha: string;
  readonly headIndex: number;
  /**
   * Count all four carried subjects so a clean receipt differs from no carried work.
   * Read marks and reclassifications lack marker columns; intersect previous-session rows
   * after materialization rather than reporting zero for read-mark-only carry.
   */
  readonly items: number;
}

export interface ReviewSessionView {
  /** Present once the session materialized; its rows then hold the carry-over. */
  readonly session: ReviewSessionSnapshot | undefined;
  /** Evaluated in memory, nothing here exists as a row yet. */
  readonly carried: CarriedWork;
  /**
   * Undefined means first-ever session only. Re-resolve origin after materialization because
   * read-mark-only carry has no marker column. The named brief is the carried span's near end.
   */
  readonly carriedFrom: CarriedFrom | undefined;
}

/** A draft as the reviewer first writes it: where it sits and what it says. */
export interface NewDraft {
  readonly anchor: DraftAnchor;
  readonly body: string;
}

/** What a session operation wrote, or why it refused. */
export type SessionOperationResult<Value> = Result<Value, ReviewSessionError>;

/** The draft row an operation wrote or removed, or why it refused. */
export type DraftOperationResult =
  SessionOperationResult<ReviewDraftCommentRow>;

/**
 * The reviewer's draft actions. Each is one session write: it materializes
 * the session if needed, refuses a frozen one, and a refusal rolls the whole
 * write back, so a refused first write leaves no session row. A draft is
 * named by its own id or by the carried row it was copied from.
 */
interface DraftOperations {
  /** `draftLimitReached` once the session holds its cap of unposted drafts. */
  addDraft(
    key: ReviewSessionKey,
    draft: NewDraft,
  ): Promise<DraftOperationResult>;
  editDraft(
    key: ReviewSessionKey,
    draftId: bigint,
    body: string,
  ): Promise<DraftOperationResult>;
  /** The reviewer placed it, so the carry-over's verdict on it is settled. */
  reanchorDraft(
    key: ReviewSessionKey,
    draftId: bigint,
    anchor: DraftAnchor,
  ): Promise<DraftOperationResult>;
  /** Answers the row that went, which a carried id does not name. */
  deleteDraft(
    key: ReviewSessionKey,
    draftId: bigint,
  ): Promise<DraftOperationResult>;
}

/**
 * The reviewer's work on the Brief itself, written the way the draft actions
 * are. A new read mark, reclassification or decision refuses with
 * `sessionRecordLimitReached` once the session's own rows of that kind match
 * the Brief's Chunks, groups or flags; rewriting a key it holds never does.
 */
interface ReviewWorkOperations {
  setChunkRead(
    key: ReviewSessionKey,
    input: ChunkReadInput,
  ): Promise<SessionOperationResult<ChunkReadInput>>;
  reclassifyGroup(
    key: ReviewSessionKey,
    input: GroupReclassificationInput,
  ): Promise<SessionOperationResult<ReviewGroupReclassificationRow>>;
  /** The whole list is one write; answers how many decisions it wrote. */
  decideRisks(
    key: ReviewSessionKey,
    decisions: readonly DispositionInput[],
  ): Promise<SessionOperationResult<number>>;
  /** Back to undecided; answers how many decisions it removed. */
  reopenRisks(
    key: ReviewSessionKey,
    anchors: readonly DispositionAnchor[],
  ): Promise<SessionOperationResult<number>>;
  /** The provisional submit verdict. Never carried, a new session starts over. */
  setOutcome(
    key: ReviewSessionKey,
    outcome: ReviewOutcome,
  ): Promise<SessionOperationResult<ReviewSessionRow>>;
}

/** What publishing to GitHub reads and records on the session. */
interface PublishOperations {
  /** Every draft the session holds, published ones included, oldest first. */
  listDrafts(
    key: ReviewSessionKey,
  ): Promise<SessionOperationResult<readonly ReviewDraftCommentRow[]>>;
  /** Flip the drafts to `submitted`; answers how many it flipped. */
  recordPublishedDrafts(
    key: ReviewSessionKey,
    published: PublishedDraftsInput,
  ): Promise<SessionOperationResult<number>>;
  /**
   * Record a reply's wrapping review on a session that already exists;
   * `sessionNotFound` rather than a create when none does.
   */
  recordReplyReview(
    key: ReviewSessionKey,
    githubReviewId: bigint,
  ): Promise<SessionOperationResult<ReviewSubmittedReviewRow>>;
  /**
   * Hold drafts for one publish attempt, saved before GitHub is called, so
   * it materializes the session. All or nothing: one draft that is unknown,
   * published, orphaned or already claimed refuses the whole claim.
   */
  claimDrafts(
    key: ReviewSessionKey,
    input: ClaimDraftsInput,
  ): Promise<SessionOperationResult<DraftClaim>>;
  /**
   * The claim's drafts reached GitHub: they become `submitted`. Lands on
   * every row holding the claim across the reviewer's sessions on the PR, a
   * carried copy included, and passes a frozen session. Never materializes;
   * answers how many rows it settled.
   */
  settleClaim(
    key: ReviewSessionKey,
    input: SettleClaimInput,
  ): Promise<SessionOperationResult<number>>;
  /** As `settleClaim`, but the drafts stay drafts with the claim cleared. */
  releaseClaim(
    key: ReviewSessionKey,
    input: ReleaseClaimInput,
  ): Promise<SessionOperationResult<number>>;
}

export interface ReviewSessionRepository
  extends DraftOperations, ReviewWorkOperations, PublishOperations {
  /** Read by key. Absence is a normal `undefined`, never a create. */
  get(key: ReviewSessionKey): Promise<ReviewSessionSnapshot | undefined>;
  /**
   * The session as it stands plus, while it does not exist yet, the previous
   * session's work re-placed onto this Brief. Creates NOTHING, the verdicts
   * become rows only when the reviewer writes. `briefUnreadable` when the
   * evaluation needs a Brief body that will not parse; a write refuses the
   * same way.
   */
  preview(key: ReviewSessionKey): Promise<ReviewSessionPreview>;
}

export type ReviewSessionPreview = Result<
  ReviewSessionView,
  ReviewSessionError
>;

type SessionFactsRead = Result<BriefSessionFacts, ReviewSessionError>;

/** The most rows of each kind a session may hold; an absent one is no limit. */
interface SessionRecordLimits {
  readonly chunks?: number;
  readonly groups?: number;
  readonly flags?: number;
}

type RecordLimitsRead = Result<SessionRecordLimits, ReviewSessionError>;

/** `undefined` when nothing is pending, so nothing needs the body. */
type PendingFactsRead = Result<
  BriefSessionFacts | undefined,
  ReviewSessionError
>;

/** What the current Brief contributes to an evaluation. */
interface BriefFacts {
  readonly pullRequestId: PullRequestRowId;
  readonly baseSha: string;
  readonly headIndex: number;
}

/** One Brief of the chain: its head and what it carried from its predecessor. */
interface ChainBrief {
  readonly headSha: string;
  readonly headIndex: number;
  readonly carriedChunkIds: string | null;
  readonly anchorState: string | null;
}

/**
 * Intersect carried_chunk_ids across every hop. A newest-hop match alone could accept
 * a re-minted chunk that reused an id without preserving what the reviewer opened.
 */
function carriedThroughChain(
  chain: readonly ChainBrief[],
  fromHeadIndex: number,
): string[] {
  let survivors: Set<string> | undefined;
  for (const step of chain) {
    if (step.headIndex <= fromHeadIndex) {
      continue;
    }
    const parsed = StoredIdsSchema.safeParse(step.carriedChunkIds);
    const carried = new Set(parsed.success ? parsed.data : []);
    survivors =
      survivors === undefined
        ? carried
        : new Set([...survivors].filter((id) => carried.has(id)));
  }
  return survivors === undefined ? [] : [...survivors];
}

/**
 * Require adjacent descent after the previous session's own brief; its earlier stamp is irrelevant.
 * Null stamps prove nothing. Same-head retarget anchoring may skip the judged row
 * by anchoring to the nearest different head, so it cannot prove chain adjacency.
 */
function descendedThroughChain(
  chain: readonly ChainBrief[],
  fromHeadIndex: number,
): boolean {
  for (let index = 1; index < chain.length; index++) {
    const step = chain[index];
    const adjacent = chain[index - 1];
    if (step === undefined || adjacent === undefined) {
      return false;
    }
    if (step.headIndex <= fromHeadIndex) {
      continue;
    }
    if (step.anchorState !== AnchorStates.ANCHORED) {
      return false;
    }
    if (step.headSha === adjacent.headSha) {
      return false;
    }
  }
  return true;
}

/** The reviewer's previous session and the Brief it sat on. */
interface PreviousSession {
  readonly id: ReviewSessionId;
  readonly baseSha: string;
  readonly headSha: string;
  readonly headIndex: number;
}

/** The one row a `.returning()` insert owes; its absence is an infra error. */
function only<TRow>(rows: TRow[], subject: string): TRow {
  const row = rows[0];
  if (row === undefined) {
    throw new Error(`${subject} write returned no row`);
  }
  return row;
}

/** One disposition anchor as a single comparable key. */
function deriveAnchorKey(anchor: DispositionAnchor): string {
  return [
    anchor.filePath,
    anchor.attribute,
    anchor.regionStart,
    anchor.regionEnd,
  ].join("\u0000");
}

function shapeDraftCommentValues(
  anchor: DraftAnchor,
): Pick<
  typeof reviewDraftComment.$inferInsert,
  "kind" | "filePath" | "side" | "startSide" | "startLine" | "endLine"
> {
  if (anchor.kind === CommentAnchorKinds.FILE) {
    return {
      kind: CommentAnchorKinds.FILE,
      filePath: anchor.file,
      side: null,
      startSide: null,
      startLine: null,
      endLine: null,
    };
  }
  return {
    kind: CommentAnchorKinds.LINE,
    filePath: anchor.file,
    side: anchor.side,
    startSide: anchor.startSide ?? null,
    startLine: anchor.startLine,
    endLine: anchor.endLine,
  };
}

function parseLineDraftAnchor(row: LineDraftCommentRow): LineDraftAnchor {
  const anchor: LineDraftAnchor = {
    kind: CommentAnchorKinds.LINE,
    file: row.filePath,
    side: row.side,
    startLine: row.startLine,
    endLine: row.endLine,
  };
  if (row.startSide !== null) {
    return { ...anchor, startSide: row.startSide };
  }
  return anchor;
}

function parseDraftAnchor(row: DraftCommentSqlRow): DraftAnchor {
  if (row.kind === CommentAnchorKinds.FILE) {
    if (!isFileDraftCommentRow(row)) {
      throw new Error("file-arm draft carries line columns");
    }
    return { kind: CommentAnchorKinds.FILE, file: row.filePath };
  }
  if (!isLineDraftCommentRow(row)) {
    throw new Error("line-arm draft missing coordinates");
  }
  return parseLineDraftAnchor(row);
}

function parseDraftCommentRow(row: DraftCommentSqlRow): ReviewDraftCommentRow {
  return {
    id: row.id,
    installationId: row.installationId,
    reviewSessionId: row.reviewSessionId,
    anchor: parseDraftAnchor(row),
    body: row.body,
    status: row.status,
    anchorStatus: row.anchorStatus,
    carriedFromSessionId: row.carriedFromSessionId,
    carriedFromCommentId: row.carriedFromCommentId,
    publishClaim: row.publishClaim,
    publishClaimedAt: row.publishClaimedAt,
    createdAt: row.createdAt,
  };
}

/** Refuses a claimed draft the way `refusals` says its claim state earns. */
function checkClaim(
  row: DraftCommentSqlRow,
  now: Date,
  refusals: ClaimRefusals,
): SessionOperationResult<undefined> {
  const refusal = refusals[deriveClaimState(row, now)];
  if (refusal !== undefined) {
    return fail(refusal, `draft ${row.id} is held by a publish attempt`);
  }
  return { ok: true, value: undefined };
}

/** A draft a publish attempt may take: still a draft, placed, unclaimed. */
function checkClaimable(
  row: DraftCommentSqlRow,
  now: Date,
): SessionOperationResult<undefined> {
  if (row.status === DraftCommentStatuses.SUBMITTED) {
    return fail(
      ReviewSessionErrorCodes.DRAFT_ALREADY_PUBLISHED,
      `draft ${row.id} is already published`,
    );
  }
  if (row.anchorStatus === AnchorStatuses.ORPHANED) {
    return fail(
      ReviewSessionErrorCodes.DRAFT_ANCHOR_ORPHANED,
      `draft ${row.id} points at no code in this brief`,
    );
  }
  return checkClaim(row, now, CLAIMED_DRAFT_REFUSALS);
}

function fail(
  code: ReviewSessionErrorCode,
  message: string,
): Result<never, ReviewSessionError> {
  return { ok: false, error: { code, message } };
}

/**
 * Refuses once a session would hold more rows of a kind than the Brief
 * allows. An absent limit refuses nothing.
 */
function checkRecordLimit(
  held: number,
  limit: number | undefined,
  subject: string,
): SessionOperationResult<undefined> {
  if (limit !== undefined && held > limit) {
    return fail(
      ReviewSessionErrorCodes.SESSION_RECORD_LIMIT_REACHED,
      `review_session would hold ${held} ${subject}, the brief has ${limit}`,
    );
  }
  return { ok: true, value: undefined };
}

function throwIfPreviousChanged(
  expected: PreviousSession | undefined,
  current: PreviousSession | undefined,
): void {
  const changed = current?.id !== expected?.id;
  if (changed) {
    throw new Error("previous review_session changed before the first write");
  }
}

/**
 * Build the Review Session repository. Not exported from `index.ts` on its
 * own, `createTenantRepository` composes it, so a caller cannot reach it without a ctx.
 */
export function createReviewSessionRepository(
  db: AppDrizzle,
  scope: RowScope,
): ReviewSessionRepository {
  /** The current Brief's own contribution to an evaluation. */
  async function readBriefCarrySlice(
    tx: Reader,
    briefId: BriefRowId,
  ): Promise<BriefFacts | undefined> {
    const rows = await tx
      .select({
        pullRequestId: brief.pullRequestId,
        baseSha: brief.baseSha,
        headIndex: brief.headIndex,
      })
      .from(brief)
      .where(
        and(
          scope.matchesChild(brief.installationId, brief.pullRequestId),
          eq(brief.id, briefId),
        ),
      )
      .limit(1);
    return rows[0];
  }

  /**
   * What the Brief's body tells a session, parsed. Only ever on the outer
   * handle before a transaction opens, or on the transaction itself: the
   * outer handle inside an open transaction deadlocks a single connection.
   */
  async function readSessionFacts(
    reader: Reader,
    briefId: BriefRowId,
  ): Promise<SessionFactsRead> {
    const rows = await reader
      .select({ body: brief.body })
      .from(brief)
      .where(
        and(
          scope.matchesChild(brief.installationId, brief.pullRequestId),
          eq(brief.id, briefId),
        ),
      )
      .limit(1);
    const row = rows[0];
    if (row === undefined) {
      return failBriefNotInTenant(briefId);
    }

    const read = readBriefSessionFacts(row.body);
    if (!read.ok) {
      return fail(
        ReviewSessionErrorCodes.BRIEF_UNREADABLE,
        `brief ${briefId} body yields no session facts`,
      );
    }
    return { ok: true, value: read.value };
  }

  /**
   * The Brief's stored counts. A row written before them falls back to its
   * body on the transaction itself; a body that will not parse sets no limit.
   */
  async function readRecordLimits(
    tx: Tx,
    briefId: BriefRowId,
  ): Promise<RecordLimitsRead> {
    const rows = await tx
      .select({
        chunks: brief.sessionChunkCount,
        groups: brief.sessionGroupCount,
        flags: brief.sessionFlagCount,
      })
      .from(brief)
      .where(
        and(
          scope.matchesChild(brief.installationId, brief.pullRequestId),
          eq(brief.id, briefId),
        ),
      )
      .limit(1);
    const row = rows[0];
    if (row === undefined) {
      return failBriefNotInTenant(briefId);
    }
    const { chunks, groups, flags } = row;
    if (chunks !== null && groups !== null && flags !== null) {
      return { ok: true, value: { chunks, groups, flags } };
    }

    const read = await readSessionFacts(tx, briefId);
    if (read.ok) {
      const facts = read.value;
      const counted = {
        chunks: facts.markableChunkCount,
        groups: facts.groupIds.length,
        flags: facts.flags.length,
      };
      return { ok: true, value: counted };
    }
    if (read.error.code === ReviewSessionErrorCodes.BRIEF_UNREADABLE) {
      return { ok: true, value: {} };
    }
    return read;
  }

  /** The reviewer's newest session on an OLDER Brief of the same PR. */
  async function previousSession(
    tx: Reader,
    facts: BriefFacts,
    reviewerId: ReviewerId,
  ): Promise<PreviousSession | undefined> {
    const rows = await tx
      .select({
        id: reviewSession.id,
        baseSha: brief.baseSha,
        headSha: brief.headSha,
        headIndex: brief.headIndex,
      })
      .from(reviewSession)
      .innerJoin(brief, eq(reviewSession.briefId, brief.id))
      .where(
        and(
          scope.matchesWorld(reviewSession.installationId),
          eq(reviewSession.reviewerId, reviewerId),
          eq(brief.pullRequestId, facts.pullRequestId),
          lt(brief.headIndex, facts.headIndex),
        ),
      )
      .orderBy(desc(brief.headIndex))
      .limit(1);
    return rows[0];
  }

  /**
   * Every Brief from the previous session's up to the current one, oldest
   * first, the chain both the hops and the carried chunk set are read off.
   */
  async function chainBriefs(
    tx: Reader,
    facts: BriefFacts,
    fromHeadIndex: number,
  ): Promise<ChainBrief[]> {
    return tx
      .select({
        headSha: brief.headSha,
        headIndex: brief.headIndex,
        carriedChunkIds: brief.carriedChunkIds,
        anchorState: brief.anchorState,
      })
      .from(brief)
      .where(
        and(
          scope.matchesChild(brief.installationId, brief.pullRequestId),
          eq(brief.pullRequestId, facts.pullRequestId),
          gte(brief.headIndex, fromHeadIndex),
          lte(brief.headIndex, facts.headIndex),
        ),
      )
      .orderBy(asc(brief.headIndex));
  }

  /**
   * The hop chain over those Brief heads, linked by SHA. Bounded by the chain,
   * not by the PR's whole append-only hop history: `hunk_span` keeps a row per
   * push forever. The endpoint filters ride the natural key's leading columns;
   * the exact pairing is `assembleHops`'s.
   */
  async function hopChain(
    tx: Reader,
    facts: BriefFacts,
    heads: readonly string[],
  ): Promise<Hop[] | null> {
    if (heads.length < 2) {
      return assembleHops(heads, []);
    }
    const rows = await tx
      .select({
        baselineSha: hunkSpan.baselineSha,
        headSha: hunkSpan.headSha,
        spans: hunkSpan.spans,
      })
      .from(hunkSpan)
      .where(
        and(
          scope.matchesChild(hunkSpan.installationId, hunkSpan.pullRequestId),
          eq(hunkSpan.pullRequestId, facts.pullRequestId),
          inArray(hunkSpan.baselineSha, heads.slice(0, -1)),
          inArray(hunkSpan.headSha, heads.slice(1)),
        ),
      );
    return assembleHops(heads, rows);
  }

  /** The previous session's rows, reduced to what the evaluation reads. */

  async function previousWork(
    tx: Reader,
    sessionId: ReviewSessionId,
  ): Promise<PreviousWork> {
    const [comments, marks, reclassifications, dispositions] =
      await Promise.all([
        tx
          .select()
          .from(reviewDraftComment)
          .where(
            and(
              scope.matchesWorld(reviewDraftComment.installationId),
              eq(reviewDraftComment.reviewSessionId, sessionId),
            ),
          )
          .orderBy(asc(reviewDraftComment.id)),
        tx
          .select({ chunkId: reviewReadMark.chunkId })
          .from(reviewReadMark)
          .where(
            and(
              scope.matchesWorld(reviewReadMark.installationId),
              eq(reviewReadMark.reviewSessionId, sessionId),
            ),
          )
          .orderBy(asc(reviewReadMark.id)),
        tx
          .select({
            changeGroupId: reviewGroupReclassification.changeGroupId,
            category: reviewGroupReclassification.category,
          })
          .from(reviewGroupReclassification)
          .where(
            and(
              scope.matchesWorld(reviewGroupReclassification.installationId),
              eq(reviewGroupReclassification.reviewSessionId, sessionId),
            ),
          )
          .orderBy(asc(reviewGroupReclassification.id)),
        tx
          .select({
            filePath: disposition.filePath,
            attribute: disposition.attribute,
            regionStart: disposition.regionStart,
            regionEnd: disposition.regionEnd,
            decision: disposition.decision,
            reason: disposition.reason,
            evidenceStatus: disposition.evidenceStatus,
            evidenceKind: disposition.evidenceKind,
            evidenceRef: disposition.evidenceRef,
            decidedAt: disposition.decidedAt,
          })
          .from(disposition)
          .where(
            and(
              scope.matchesWorld(disposition.installationId),
              eq(disposition.reviewSessionId, sessionId),
            ),
          )
          .orderBy(asc(disposition.id)),
      ]);
    return {
      draftComments: comments.map((row) => {
        const parsed = parseDraftCommentRow(row);
        return {
          id: parsed.id,
          anchor: parsed.anchor,
          body: parsed.body,
          status: parsed.status,
          carriedFromCommentId: parsed.carriedFromCommentId,
        };
      }),
      readMarks: marks.map((mark) => mark.chunkId),
      reclassifications,
      dispositions: dispositions.map(
        ({ evidenceKind, evidenceRef, ...row }) => ({
          ...row,
          evidence:
            evidenceKind === null
              ? null
              : { kind: evidenceKind, ref: evidenceRef },
        }),
      ),
    };
  }

  /**
   * Re-evaluate inside materialization rather than trusting a read payload,
   * preserving late writes. The session facts are read before the
   * transaction opens: a read on the outer handle while it is open deadlocks
   * a single-connection database.
   */
  async function evaluatePending(
    tx: Reader,
    facts: BriefFacts,
    previous: PreviousSession,
    sessionFacts: BriefSessionFacts,
  ): Promise<CarriedWork> {
    const chain = await chainBriefs(tx, facts, previous.headIndex);
    const heads = chain.map((row) => row.headSha);
    const [work, hops] = await Promise.all([
      previousWork(tx, previous.id),
      hopChain(tx, facts, heads),
    ]);
    return evaluateCarryOver(work, {
      carriedChunkIds: carriedThroughChain(chain, previous.headIndex),
      groupIdsDescended: descendedThroughChain(chain, previous.headIndex),
      groupIds: sessionFacts.groupIds,
      flags: sessionFacts.flags,
      filePaths: sessionFacts.filePaths,
      hops,
      baseShaMoved: previous.baseSha !== facts.baseSha,
    });
  }

  /**
   * The row this session holds for `id`, its own, or the copy of the carried
   * row `id` named. At most one matches: ids come from one sequence, so a
   * source id is never also a row id here.
   */
  function addressedDraft(sessionId: ReviewSessionId, id: bigint) {
    return and(
      ownedBy(sessionId),
      or(
        eq(reviewDraftComment.id, id),
        eq(reviewDraftComment.carriedFromCommentId, id),
      ),
    );
  }

  /** A stored draft is addressable only through the session that owns it. */
  function ownedBy(sessionId: ReviewSessionId) {
    return and(
      scope.matchesWorld(reviewDraftComment.installationId),
      eq(reviewDraftComment.reviewSessionId, sessionId),
    );
  }

  /** The rows of a session-owned table that belong to `sessionId`. */
  function ownedReadMarks(sessionId: ReviewSessionId) {
    return and(
      scope.matchesWorld(reviewReadMark.installationId),
      eq(reviewReadMark.reviewSessionId, sessionId),
    );
  }

  function ownedReclassifications(sessionId: ReviewSessionId) {
    return and(
      scope.matchesWorld(reviewGroupReclassification.installationId),
      eq(reviewGroupReclassification.reviewSessionId, sessionId),
    );
  }

  function ownedDispositions(sessionId: ReviewSessionId) {
    return and(
      scope.matchesWorld(disposition.installationId),
      eq(disposition.reviewSessionId, sessionId),
    );
  }

  /**
   * Mark a Chunk read. Carry-over copies read marks only for Chunks of this
   * Brief, so every row the session holds counts against its Chunks.
   */
  async function markChunkRead(
    tx: Tx,
    session: ReviewSessionRow,
    input: ChunkReadInput,
  ): Promise<SessionOperationResult<ChunkReadInput>> {
    const inserted = await tx
      .insert(reviewReadMark)
      .values({
        installationId: scope.installationId,
        reviewSessionId: session.id,
        chunkId: input.chunkId,
      })
      .onConflictDoNothing({
        target: [reviewReadMark.reviewSessionId, reviewReadMark.chunkId],
      })
      .returning({ id: reviewReadMark.id });
    if (inserted.length === 0) {
      return { ok: true, value: input };
    }

    const counted = await tx
      .select({ held: count() })
      .from(reviewReadMark)
      .where(ownedReadMarks(session.id));
    const held = counted[0]?.held ?? 0;
    const limits = await readRecordLimits(tx, session.briefId);
    if (!limits.ok) {
      return limits;
    }
    const limit = checkRecordLimit(held, limits.value.chunks, "read marks");
    if (!limit.ok) {
      return limit;
    }
    return { ok: true, value: input };
  }

  async function clearChunkRead(
    tx: Tx,
    sessionId: ReviewSessionId,
    chunkId: string,
  ): Promise<void> {
    await tx
      .delete(reviewReadMark)
      .where(
        and(ownedReadMarks(sessionId), eq(reviewReadMark.chunkId, chunkId)),
      );
  }

  /**
   * Set a group's category. Carry-over copies reclassifications only for
   * groups of this Brief, so every row counts against its groups.
   */
  async function writeReclassification(
    tx: Tx,
    session: ReviewSessionRow,
    input: GroupReclassificationInput,
  ): Promise<SessionOperationResult<ReviewGroupReclassificationRow>> {
    const inserted = await tx
      .insert(reviewGroupReclassification)
      .values({
        installationId: scope.installationId,
        reviewSessionId: session.id,
        changeGroupId: input.changeGroupId,
        category: input.category,
      })
      .onConflictDoNothing({
        target: [
          reviewGroupReclassification.reviewSessionId,
          reviewGroupReclassification.changeGroupId,
        ],
      })
      .returning();
    const created = inserted[0];
    if (created === undefined) {
      const rows = await tx
        .update(reviewGroupReclassification)
        .set({ category: input.category })
        .where(
          and(
            ownedReclassifications(session.id),
            eq(reviewGroupReclassification.changeGroupId, input.changeGroupId),
          ),
        )
        .returning();
      return { ok: true, value: only(rows, "review_group_reclassification") };
    }

    const counted = await tx
      .select({ held: count() })
      .from(reviewGroupReclassification)
      .where(ownedReclassifications(session.id));
    const held = counted[0]?.held ?? 0;
    const limits = await readRecordLimits(tx, session.briefId);
    if (!limits.ok) {
      return limits;
    }
    const limit = checkRecordLimit(held, limits.value.groups, "groups");
    if (!limit.ok) {
      return limit;
    }
    return { ok: true, value: created };
  }

  /**
   * Record decisions on risk flags, idempotent on each anchor. A carried
   * decision can sit on a flag this Brief no longer fires, so only the
   * session's own decisions, the ones with no carry verdict, count against
   * the Brief's flags.
   */
  async function decideOnFlags(
    tx: Tx,
    session: ReviewSessionRow,
    decisions: readonly DispositionInput[],
  ): Promise<SessionOperationResult<number>> {
    const sessionId = session.id;
    const held = await tx
      .select({
        filePath: disposition.filePath,
        attribute: disposition.attribute,
        regionStart: disposition.regionStart,
        regionEnd: disposition.regionEnd,
        carryStatus: disposition.carryStatus,
      })
      .from(disposition)
      .where(ownedDispositions(sessionId));
    const heldKeys = new Set(held.map(deriveAnchorKey));
    const own = held.filter((row) => row.carryStatus === null).length;
    const fresh = new Set(
      decisions.map(deriveAnchorKey).filter((key) => !heldKeys.has(key)),
    );
    if (fresh.size > 0) {
      const limits = await readRecordLimits(tx, session.briefId);
      if (!limits.ok) {
        return limits;
      }
      const limit = checkRecordLimit(
        own + fresh.size,
        limits.value.flags,
        "dispositions",
      );
      if (!limit.ok) {
        return limit;
      }
    }

    await Promise.all(
      decisions.map((decision) => upsertDisposition(tx, sessionId, decision)),
    );
    return { ok: true, value: decisions.length };
  }

  async function upsertDisposition(
    tx: Tx,
    sessionId: ReviewSessionId,
    input: DispositionInput,
  ): Promise<void> {
    const decided = {
      decision: input.decision,
      reason: input.reason ?? null,
      evidenceKind: input.evidence?.kind ?? null,
      evidenceRef: input.evidence?.ref ?? null,
      decidedAt: new Date(),
    };
    await tx
      .insert(disposition)
      .values({
        installationId: scope.installationId,
        reviewSessionId: sessionId,
        filePath: input.filePath,
        attribute: input.attribute,
        regionStart: input.regionStart,
        regionEnd: input.regionEnd,
        ...decided,
      })
      .onConflictDoUpdate({
        target: [
          disposition.reviewSessionId,
          disposition.filePath,
          disposition.attribute,
          disposition.regionStart,
          disposition.regionEnd,
        ],
        // Deciding here settles both questions the carry brought over, the
        // re-look AND the evidence the old decision lost.
        set: { ...decided, carryStatus: null, evidenceStatus: null },
      });
  }

  /** Undo decisions; answers how many the session held. */
  async function removeDispositions(
    tx: Tx,
    sessionId: ReviewSessionId,
    anchors: readonly DispositionAnchor[],
  ): Promise<number> {
    const removed = await Promise.all(
      anchors.map((anchor) =>
        tx
          .delete(disposition)
          .where(
            and(
              ownedDispositions(sessionId),
              eq(disposition.filePath, anchor.filePath),
              eq(disposition.attribute, anchor.attribute),
              eq(disposition.regionStart, anchor.regionStart),
              eq(disposition.regionEnd, anchor.regionEnd),
            ),
          )
          .returning({ id: disposition.id }),
      ),
    );
    return removed.filter((rows) => rows.length > 0).length;
  }

  async function upsertSubmittedReview(
    tx: Tx,
    sessionId: ReviewSessionId,
    githubReviewId: bigint,
  ): Promise<ReviewSubmittedReviewRow> {
    const rows = await tx
      .insert(reviewSubmittedReview)
      .values({
        installationId: scope.installationId,
        reviewSessionId: sessionId,
        githubReviewId,
      })
      .onConflictDoUpdate({
        target: [
          reviewSubmittedReview.reviewSessionId,
          reviewSubmittedReview.githubReviewId,
        ],
        set: { githubReviewId },
      })
      .returning();
    return only(rows, "review_submitted_review");
  }

  /** Flip published drafts and record their review; answers the flipped count. */
  async function recordPublished(
    tx: Tx,
    sessionId: ReviewSessionId,
    published: PublishedDraftsInput,
  ): Promise<number> {
    if (published.githubReviewId !== undefined) {
      await upsertSubmittedReview(tx, sessionId, published.githubReviewId);
    }
    if (published.draftIds.length === 0) {
      return 0;
    }

    const flipped = await tx
      .update(reviewDraftComment)
      .set({ status: DraftCommentStatuses.SUBMITTED })
      .where(
        and(
          ownedBy(sessionId),
          inArray(reviewDraftComment.id, [...published.draftIds]),
        ),
      )
      .returning({ id: reviewDraftComment.id });
    return flipped.length;
  }

  /**
   * The claims a session's drafts hold, by row id. A copy inherits its
   * source's claim, so the attempt's settle or release reaches both rows.
   */
  async function readHeldClaims(
    tx: Tx,
    sessionId: ReviewSessionId,
  ): Promise<Map<bigint, HeldClaim>> {
    const rows = await tx
      .select({
        id: reviewDraftComment.id,
        publishClaim: reviewDraftComment.publishClaim,
        publishClaimedAt: reviewDraftComment.publishClaimedAt,
      })
      .from(reviewDraftComment)
      .where(
        and(ownedBy(sessionId), isNotNull(reviewDraftComment.publishClaim)),
      );
    return new Map(rows.map((row) => [row.id, row]));
  }

  /**
   * Every draft row holding `claim` across the reviewer's sessions on this
   * Brief's PR. A claim token is fresh per attempt, so the match is exact;
   * the PR and reviewer bound it to rows the claim could have reached.
   */
  async function matchClaimHolders(
    tx: Tx,
    session: ReviewSessionRow,
    claim: string,
  ) {
    const facts = await readBriefCarrySlice(tx, session.briefId);
    if (facts === undefined) {
      throw new Error("review_session brief vanished inside its transaction");
    }
    const reviewerSessions = tx
      .select({ id: reviewSession.id })
      .from(reviewSession)
      .innerJoin(brief, eq(reviewSession.briefId, brief.id))
      .where(
        and(
          scope.matchesWorld(reviewSession.installationId),
          scope.matchesChild(brief.installationId, brief.pullRequestId),
          eq(reviewSession.reviewerId, session.reviewerId),
          eq(brief.pullRequestId, facts.pullRequestId),
        ),
      );
    return and(
      scope.matchesWorld(reviewDraftComment.installationId),
      eq(reviewDraftComment.publishClaim, claim),
      inArray(reviewDraftComment.reviewSessionId, reviewerSessions),
    );
  }

  /** Clear `claim` off every row holding it; answers how many it touched. */
  async function clearClaim(
    tx: Tx,
    session: ReviewSessionRow,
    claim: string,
    values: Partial<typeof reviewDraftComment.$inferInsert>,
  ): Promise<number> {
    const holders = await matchClaimHolders(tx, session, claim);
    const rows = await tx
      .update(reviewDraftComment)
      .set({ ...values, publishClaim: null, publishClaimedAt: null })
      .where(holders)
      .returning({ id: reviewDraftComment.id });
    return rows.length;
  }

  /**
   * Copy the evaluated work onto the new session, one statement per table.
   * Carry-over COPIES; it never points at the old rows. An orphan keeps its
   * last known file and line: the CHECK leaves no sentinel to write, and a
   * violation would throw and take the whole materialization down.
   */
  async function copyCarried(
    tx: Tx,
    session: ReviewSessionRow,
    carried: CarriedWork,
    carriedFromSessionId: ReviewSessionId,
  ): Promise<void> {
    const owned = {
      installationId: scope.installationId,
      reviewSessionId: session.id,
    };
    const writes: Promise<unknown>[] = [];
    if (carried.draftComments.length > 0) {
      const claims = await readHeldClaims(tx, carriedFromSessionId);
      writes.push(
        tx.insert(reviewDraftComment).values(
          carried.draftComments.map((row) => ({
            ...owned,
            ...shapeDraftCommentValues(row.anchor),
            body: row.body,
            anchorStatus: row.anchorStatus,
            carriedFromSessionId,
            // The source row, so a write naming the id the read handed out
            // reaches this copy on every write, not just the first.
            carriedFromCommentId: row.id,
            publishClaim: claims.get(row.id)?.publishClaim ?? null,
            publishClaimedAt: claims.get(row.id)?.publishClaimedAt ?? null,
          })),
        ),
      );
    }
    if (carried.readMarks.length > 0) {
      writes.push(
        tx
          .insert(reviewReadMark)
          .values(carried.readMarks.map((chunkId) => ({ ...owned, chunkId }))),
      );
    }
    if (carried.reclassifications.length > 0) {
      writes.push(
        tx
          .insert(reviewGroupReclassification)
          .values(
            carried.reclassifications.map((row) => ({ ...owned, ...row })),
          ),
      );
    }
    if (carried.dispositions.length > 0) {
      writes.push(
        tx.insert(disposition).values(
          carried.dispositions.map((row) => ({
            ...owned,
            filePath: row.filePath,
            attribute: row.attribute,
            regionStart: row.regionStart,
            regionEnd: row.regionEnd,
            decision: row.decision,
            reason: row.reason,
            carryStatus: row.carryStatus,
            evidenceStatus: row.evidenceStatus,
            evidenceKind: row.evidence?.kind ?? null,
            evidenceRef: row.evidence?.ref ?? null,
            decidedAt: row.decidedAt,
          })),
        ),
      );
    }
    await Promise.all(writes);
  }

  /** True once the reviewer has a session on a NEWER Brief of the same PR. */
  async function hasNewerSession(
    tx: Tx,
    facts: BriefFacts,
    reviewerId: ReviewerId,
  ): Promise<boolean> {
    const rows = await tx
      .select({ id: reviewSession.id })
      .from(reviewSession)
      .innerJoin(brief, eq(reviewSession.briefId, brief.id))
      .where(
        and(
          scope.matchesWorld(reviewSession.installationId),
          eq(reviewSession.reviewerId, reviewerId),
          eq(brief.pullRequestId, facts.pullRequestId),
          gt(brief.headIndex, facts.headIndex),
        ),
      )
      .limit(1);
    return rows[0] !== undefined;
  }

  /**
   * The session row for a key, locked until the transaction ends, or
   * `undefined`. Every write to a session takes this lock first, so two
   * writes to one session run one after the other.
   */
  async function lockSession(
    tx: Tx,
    key: ReviewSessionKey,
  ): Promise<ReviewSessionRow | undefined> {
    const rows = await tx
      .select()
      .from(reviewSession)
      .where(
        and(
          scope.matchesWorld(reviewSession.installationId),
          eq(reviewSession.briefId, key.briefId),
          eq(reviewSession.reviewerId, key.reviewerId),
        ),
      )
      .limit(1)
      .for("update");
    return rows[0];
  }

  /**
   * The previous session, its row locked until the transaction ends. A write
   * to it either committed before this returns or waits for the
   * materialization and then finds its session frozen. The wait for the lock
   * can outlast a newer previous session committing, hence the re-read.
   */
  async function lockPreviousSession(
    tx: Tx,
    facts: BriefFacts,
    reviewerId: ReviewerId,
  ): Promise<PreviousSession | undefined> {
    const found = await previousSession(tx, facts, reviewerId);
    if (found === undefined) {
      return undefined;
    }

    await tx
      .select({ id: reviewSession.id })
      .from(reviewSession)
      .where(
        and(
          scope.matchesWorld(reviewSession.installationId),
          eq(reviewSession.id, found.id),
        ),
      )
      .for("update");

    const locked = await previousSession(tx, facts, reviewerId);
    throwIfPreviousChanged(found, locked);
    return locked;
  }

  function failFrozen(
    facts: BriefFacts,
    reviewerId: ReviewerId,
  ): Result<never, ReviewSessionError> {
    return fail(
      ReviewSessionErrorCodes.SESSION_FROZEN,
      `reviewer ${reviewerId} already works on a newer brief of pull_request ${facts.pullRequestId}`,
    );
  }

  /**
   * Create the session and copy the carried work onto it. Lock order is
   * previous, then own, on every path: a first write holds no own-row lock
   * until the previous one is taken. The freeze check precedes the insert
   * because a refusal returned from the transaction callback commits.
   */
  async function materializeSession(
    tx: Tx,
    key: ReviewSessionKey,
    facts: BriefFacts,
    sessionFacts: BriefSessionFacts | undefined,
  ): Promise<Result<ReviewSessionRow, ReviewSessionError>> {
    const previous = await lockPreviousSession(tx, facts, key.reviewerId);
    const frozen = await hasNewerSession(tx, facts, key.reviewerId);
    if (frozen) {
      return failFrozen(facts, key.reviewerId);
    }

    // DO NOTHING is the creation detector: a second concurrent first-write
    // gets no row back, skips the copy and locks the committed row instead.
    // Only the creating writer copies, so carried rows never double.
    const inserted = await tx
      .insert(reviewSession)
      .values({
        installationId: scope.installationId,
        briefId: key.briefId,
        reviewerId: key.reviewerId,
      })
      .onConflictDoNothing({
        target: [
          reviewSession.installationId,
          reviewSession.briefId,
          reviewSession.reviewerId,
        ],
      })
      .returning();
    const created = inserted[0];
    if (created === undefined) {
      const committed = await lockSession(tx, key);
      if (committed === undefined) {
        throw new Error("review_session vanished inside its own transaction");
      }
      // The wait for that lock can outlast a newer session copying from the
      // committed row, so the freeze is checked again under the lock.
      const frozenUnderLock = await hasNewerSession(tx, facts, key.reviewerId);
      if (frozenUnderLock) {
        return failFrozen(facts, key.reviewerId);
      }
      return { ok: true, value: committed };
    }

    // With no previous row there was nothing to lock, so a first write on an
    // older Brief can commit between the lookup and the insert. Its work would
    // be left behind for good, the same reason the throw below is deliberate.
    const latest = await previousSession(tx, facts, key.reviewerId);
    throwIfPreviousChanged(previous, latest);
    if (previous === undefined) {
      return { ok: true, value: created };
    }
    if (sessionFacts === undefined) {
      // The probe lost a race, a concurrent first write on an older Brief
      // created this session. Failing is deliberate: carry-over cannot be
      // re-evaluated inside the open transaction, and skipping it writes
      // without the carried work for good.
      throw new Error(
        "previous review_session appeared before the first write",
      );
    }

    const carried = await evaluatePending(tx, facts, previous, sessionFacts);
    await copyCarried(tx, created, carried, previous.id);
    // Stamped here and never recomputed: the receipt states what came
    // across, and every marker it could be re-derived from is one the
    // reviewer's own later work clears.
    await tx
      .update(reviewSession)
      .set({ carriedItemCount: countPendingCarriedItems(carried) })
      .where(eq(reviewSession.id, created.id));
    return { ok: true, value: created };
  }

  /**
   * The session row for a key, or `undefined`, never a create. Joins the
   * anchoring `brief` through the scope's child predicate: the world mark
   * alone cannot separate two owners, so brief ownership is what keeps a
   * guessed (briefId, reviewerId) pair from reading across owners.
   */
  async function findSession(
    key: ReviewSessionKey,
  ): Promise<ReviewSessionRow | undefined> {
    const rows = await db
      .select({ session: reviewSession })
      .from(reviewSession)
      .innerJoin(brief, eq(reviewSession.briefId, brief.id))
      .where(
        and(
          scope.matchesWorld(reviewSession.installationId),
          scope.matchesChild(brief.installationId, brief.pullRequestId),
          eq(reviewSession.briefId, key.briefId),
          eq(reviewSession.reviewerId, key.reviewerId),
        ),
      )
      .limit(1);
    return rows[0]?.session;
  }

  /**
   * The session facts a materialization would evaluate against, or
   * `undefined` when there is nothing to evaluate: the session already
   * exists, or it is the reviewer's first on this PR. Both skip the body
   * parse entirely. A missing Brief is the transaction's refusal to make.
   */
  async function readPendingFacts(
    key: ReviewSessionKey,
  ): Promise<PendingFactsRead> {
    const nothingPending = { ok: true, value: undefined } as const;
    if ((await findSession(key)) !== undefined) {
      return nothingPending;
    }
    const facts = await readBriefCarrySlice(db, key.briefId);
    if (facts === undefined) {
      return nothingPending;
    }
    const previous = await previousSession(db, facts, key.reviewerId);
    if (previous === undefined) {
      return nothingPending;
    }
    return readSessionFacts(db, key.briefId);
  }

  /** The session and everything it owns, or `undefined`, never a create. */
  async function snapshotFor(
    key: ReviewSessionKey,
  ): Promise<ReviewSessionSnapshot | undefined> {
    const session = await findSession(key);
    if (session === undefined) {
      return undefined;
    }
    const [
      draftCommentRows,
      readMarks,
      reclassifications,
      submittedReviews,
      dispositions,
    ] = await Promise.all([
      db
        .select()
        .from(reviewDraftComment)
        .where(
          and(
            scope.matchesWorld(reviewDraftComment.installationId),
            eq(reviewDraftComment.reviewSessionId, session.id),
          ),
        )
        .orderBy(asc(reviewDraftComment.id)),
      db
        .select()
        .from(reviewReadMark)
        .where(
          and(
            scope.matchesWorld(reviewReadMark.installationId),
            eq(reviewReadMark.reviewSessionId, session.id),
          ),
        )
        .orderBy(asc(reviewReadMark.id)),
      db
        .select()
        .from(reviewGroupReclassification)
        .where(
          and(
            scope.matchesWorld(reviewGroupReclassification.installationId),
            eq(reviewGroupReclassification.reviewSessionId, session.id),
          ),
        )
        .orderBy(asc(reviewGroupReclassification.id)),
      db
        .select()
        .from(reviewSubmittedReview)
        .where(
          and(
            scope.matchesWorld(reviewSubmittedReview.installationId),
            eq(reviewSubmittedReview.reviewSessionId, session.id),
          ),
        )
        .orderBy(asc(reviewSubmittedReview.id)),
      db
        .select()
        .from(disposition)
        .where(
          and(
            scope.matchesWorld(disposition.installationId),
            eq(disposition.reviewSessionId, session.id),
          ),
        )
        .orderBy(asc(disposition.id)),
    ]);
    return {
      session,
      draftComments: draftCommentRows.map(parseDraftCommentRow),
      readMarks,
      reclassifications,
      submittedReviews,
      dispositions,
    };
  }

  function failBriefNotInTenant(
    briefId: BriefRowId,
  ): Result<never, ReviewSessionError> {
    return fail(
      ReviewSessionErrorCodes.PARENT_NOT_IN_TENANT,
      `brief ${briefId} not in ${scope.label}`,
    );
  }

  /** The locked session, refused when the reviewer works on a newer Brief. */
  async function refuseIfFrozen(
    tx: Tx,
    facts: BriefFacts,
    reviewerId: ReviewerId,
    session: ReviewSessionRow,
  ): Promise<SessionOperationResult<ReviewSessionRow>> {
    const frozen = await hasNewerSession(tx, facts, reviewerId);
    if (frozen) {
      return failFrozen(facts, reviewerId);
    }
    return { ok: true, value: session };
  }

  /**
   * The locked session row a write lands on, materialized first if this is
   * the first write, refused when frozen. A refusal here has written nothing.
   */
  async function openForWrite(
    tx: Tx,
    key: ReviewSessionKey,
    sessionFacts: BriefSessionFacts | undefined,
  ): Promise<SessionOperationResult<ReviewSessionRow>> {
    const facts = await readBriefCarrySlice(tx, key.briefId);
    if (facts === undefined) {
      return failBriefNotInTenant(key.briefId);
    }
    const existing = await lockSession(tx, key);
    if (existing === undefined) {
      return materializeSession(tx, key, facts, sessionFacts);
    }
    return refuseIfFrozen(tx, facts, key.reviewerId, existing);
  }

  /** As `openForWrite`, but a session that does not exist stays absent. */
  async function openExistingForWrite(
    tx: Tx,
    key: ReviewSessionKey,
  ): Promise<SessionOperationResult<ReviewSessionRow>> {
    const facts = await readBriefCarrySlice(tx, key.briefId);
    if (facts === undefined) {
      return failBriefNotInTenant(key.briefId);
    }
    const existing = await lockExistingSession(tx, key);
    if (!existing.ok) {
      return existing;
    }
    return refuseIfFrozen(tx, facts, key.reviewerId, existing.value);
  }

  /**
   * The locked session publish bookkeeping lands on. A frozen session still
   * records what reached GitHub; an absent one stays absent.
   */
  async function openForPublishRecord(
    tx: Tx,
    key: ReviewSessionKey,
  ): Promise<SessionOperationResult<ReviewSessionRow>> {
    const facts = await readBriefCarrySlice(tx, key.briefId);
    if (facts === undefined) {
      return failBriefNotInTenant(key.briefId);
    }
    return lockExistingSession(tx, key);
  }

  async function lockExistingSession(
    tx: Tx,
    key: ReviewSessionKey,
  ): Promise<SessionOperationResult<ReviewSessionRow>> {
    const existing = await lockSession(tx, key);
    if (existing === undefined) {
      return fail(
        ReviewSessionErrorCodes.SESSION_NOT_FOUND,
        `reviewer ${key.reviewerId} holds no review_session on brief ${key.briefId}`,
      );
    }
    return { ok: true, value: existing };
  }

  /**
   * One transaction: the session opened, then `operation`. Its refusal rolls
   * the transaction back, a materialization included.
   */
  async function runInSessionTransaction<Value>(
    open: (tx: Tx) => Promise<SessionOperationResult<ReviewSessionRow>>,
    operation: SessionStep<Value>,
  ): Promise<SessionOperationResult<Value>> {
    try {
      return await db.transaction(async (tx) => {
        const opened = await open(tx);
        if (!opened.ok) {
          return opened;
        }
        const done = await operation(tx, opened.value);
        if (!done.ok) {
          throw new SessionOperationRefusal(done.error);
        }
        return done;
      });
    } catch (error) {
      if (error instanceof SessionOperationRefusal) {
        return { ok: false, error: error.refusal };
      }
      throw error;
    }
  }

  /** One session write: the session locked and judged, then `operation`. */
  async function runSessionOperation<Value>(
    key: ReviewSessionKey,
    operation: SessionStep<Value>,
  ): Promise<SessionOperationResult<Value>> {
    // Read before the transaction opens: the outer handle deadlocks inside it.
    const pending = await readPendingFacts(key);
    if (!pending.ok) {
      return pending;
    }
    return runInSessionTransaction(
      (tx) => openForWrite(tx, key, pending.value),
      operation,
    );
  }

  /** A session write that never materializes; `sessionNotFound` instead. */
  async function runExistingSessionOperation<Value>(
    key: ReviewSessionKey,
    operation: SessionStep<Value>,
  ): Promise<SessionOperationResult<Value>> {
    return runInSessionTransaction(
      (tx) => openExistingForWrite(tx, key),
      operation,
    );
  }

  /**
   * The draft `draftId` names in this session, while it is still a draft and
   * no publish attempt holds it in a way `claimRefusals` refuses.
   */
  async function findWritableDraft(
    tx: Tx,
    sessionId: ReviewSessionId,
    draftId: bigint,
    claimRefusals: ClaimRefusals = CLAIMED_DRAFT_REFUSALS,
  ): Promise<DraftOperationResult> {
    const rows = await tx
      .select()
      .from(reviewDraftComment)
      .where(addressedDraft(sessionId, draftId))
      .limit(1);
    const row = rows[0];
    if (row === undefined) {
      return fail(
        ReviewSessionErrorCodes.DRAFT_NOT_FOUND,
        `review_session ${sessionId} holds no draft ${draftId}`,
      );
    }
    if (row.status === DraftCommentStatuses.SUBMITTED) {
      return fail(
        ReviewSessionErrorCodes.DRAFT_ALREADY_PUBLISHED,
        `draft ${row.id} is already published`,
      );
    }
    const claimed = checkClaim(row, new Date(), claimRefusals);
    if (!claimed.ok) {
      return claimed;
    }
    return { ok: true, value: parseDraftCommentRow(row) };
  }

  /**
   * The rows `draftIds` name in this session, one per id, judged claimable
   * at `now`; the first id that fails refuses the lot.
   */
  async function findClaimableDrafts(
    tx: Tx,
    sessionId: ReviewSessionId,
    draftIds: readonly bigint[],
    now: Date,
  ): Promise<SessionOperationResult<readonly bigint[]>> {
    const ids = [...draftIds];
    const rows = await tx
      .select()
      .from(reviewDraftComment)
      .where(
        and(
          ownedBy(sessionId),
          or(
            inArray(reviewDraftComment.id, ids),
            inArray(reviewDraftComment.carriedFromCommentId, ids),
          ),
        ),
      );
    const claimable = new Set<bigint>();
    for (const draftId of ids) {
      const row = rows.find(
        (held) => held.id === draftId || held.carriedFromCommentId === draftId,
      );
      if (row === undefined) {
        return fail(
          ReviewSessionErrorCodes.DRAFT_NOT_FOUND,
          `review_session ${sessionId} holds no draft ${draftId}`,
        );
      }
      const judged = checkClaimable(row, now);
      if (!judged.ok) {
        return judged;
      }
      claimable.add(row.id);
    }
    return { ok: true, value: [...claimable] };
  }

  /** Stamp one fresh claim on the rows; answers them oldest first. */
  async function stampClaim(
    tx: Tx,
    sessionId: ReviewSessionId,
    rowIds: readonly bigint[],
    now: Date,
  ): Promise<DraftClaim> {
    const claim = randomUUID();
    if (rowIds.length === 0) {
      return { claim, drafts: [] };
    }

    const rows = await tx
      .update(reviewDraftComment)
      .set({ publishClaim: claim, publishClaimedAt: now })
      .where(
        and(ownedBy(sessionId), inArray(reviewDraftComment.id, [...rowIds])),
      )
      .returning();
    const oldestFirst = rows.toSorted((left, right) =>
      Number(left.id - right.id),
    );
    return { claim, drafts: oldestFirst.map(parseDraftCommentRow) };
  }

  /** Move the fields of a writable draft, refusing as `findWritableDraft` does. */
  async function updateWritableDraft(
    tx: Tx,
    sessionId: ReviewSessionId,
    draftId: bigint,
    values: Partial<typeof reviewDraftComment.$inferInsert>,
  ): Promise<DraftOperationResult> {
    const held = await findWritableDraft(tx, sessionId, draftId);
    if (!held.ok) {
      return held;
    }

    const rows = await tx
      .update(reviewDraftComment)
      .set(values)
      .where(and(ownedBy(sessionId), eq(reviewDraftComment.id, held.value.id)))
      .returning();
    const row = only(rows, "review_draft_comment");
    return { ok: true, value: parseDraftCommentRow(row) };
  }

  /** The drafts a submit would post, counted under the session lock. */
  async function countUnpostedDrafts(
    tx: Tx,
    sessionId: ReviewSessionId,
  ): Promise<number> {
    const rows = await tx
      .select({ unposted: count() })
      .from(reviewDraftComment)
      .where(
        and(
          ownedBy(sessionId),
          eq(reviewDraftComment.status, DraftCommentStatuses.DRAFT),
        ),
      );
    return rows[0]?.unposted ?? 0;
  }

  return {
    async get(key) {
      return snapshotFor(key);
    },

    async addDraft(key, draft) {
      return runSessionOperation(
        key,
        async (tx, session): Promise<DraftOperationResult> => {
          const unposted = await countUnpostedDrafts(tx, session.id);
          if (unposted >= MAX_SESSION_DRAFTS) {
            return fail(
              ReviewSessionErrorCodes.DRAFT_LIMIT_REACHED,
              `review_session ${session.id} holds ${unposted} unposted drafts`,
            );
          }

          const rows = await tx
            .insert(reviewDraftComment)
            .values({
              installationId: scope.installationId,
              reviewSessionId: session.id,
              ...shapeDraftCommentValues(draft.anchor),
              body: draft.body,
            })
            .returning();
          const row = only(rows, "review_draft_comment");
          return { ok: true, value: parseDraftCommentRow(row) };
        },
      );
    },

    async editDraft(key, draftId, body) {
      return runSessionOperation(key, (tx, session) =>
        updateWritableDraft(tx, session.id, draftId, { body }),
      );
    },

    async reanchorDraft(key, draftId, anchor) {
      return runSessionOperation(key, (tx, session) =>
        updateWritableDraft(tx, session.id, draftId, {
          ...shapeDraftCommentValues(anchor),
          anchorStatus: null,
        }),
      );
    },

    async deleteDraft(key, draftId) {
      return runSessionOperation(key, async (tx, session) => {
        const held = await findWritableDraft(
          tx,
          session.id,
          draftId,
          DELETE_CLAIM_REFUSALS,
        );
        if (!held.ok) {
          return held;
        }

        await tx
          .delete(reviewDraftComment)
          .where(
            and(ownedBy(session.id), eq(reviewDraftComment.id, held.value.id)),
          );
        return held;
      });
    },

    async setChunkRead(key, input) {
      if (!input.read) {
        return runSessionOperation(key, async (tx, session) => {
          await clearChunkRead(tx, session.id, input.chunkId);
          return { ok: true, value: input };
        });
      }
      return runSessionOperation(key, (tx, session) =>
        markChunkRead(tx, session, input),
      );
    },

    async reclassifyGroup(key, input) {
      return runSessionOperation(key, (tx, session) =>
        writeReclassification(tx, session, input),
      );
    },

    async decideRisks(key, decisions) {
      return runSessionOperation(key, (tx, session) =>
        decideOnFlags(tx, session, decisions),
      );
    },

    async reopenRisks(key, anchors) {
      return runSessionOperation(key, async (tx, session) => {
        const removed = await removeDispositions(tx, session.id, anchors);
        return { ok: true, value: removed };
      });
    },

    async setOutcome(key, outcome) {
      return runSessionOperation(key, async (tx, session) => {
        const rows = await tx
          .update(reviewSession)
          .set({ reviewOutcome: outcome })
          .where(
            and(
              scope.matchesWorld(reviewSession.installationId),
              eq(reviewSession.id, session.id),
            ),
          )
          .returning();
        return { ok: true, value: only(rows, "review_session") };
      });
    },

    async listDrafts(key) {
      return runSessionOperation(key, async (tx, session) => {
        const rows = await tx
          .select()
          .from(reviewDraftComment)
          .where(ownedBy(session.id))
          .orderBy(asc(reviewDraftComment.id));
        return { ok: true, value: rows.map(parseDraftCommentRow) };
      });
    },

    async recordPublishedDrafts(key, published) {
      return runSessionOperation(key, async (tx, session) => {
        const flipped = await recordPublished(tx, session.id, published);
        return { ok: true, value: flipped };
      });
    },

    async recordReplyReview(key, githubReviewId) {
      return runExistingSessionOperation(key, async (tx, session) => {
        const row = await upsertSubmittedReview(tx, session.id, githubReviewId);
        return { ok: true, value: row };
      });
    },

    async claimDrafts(key, input) {
      const now = input.now ?? new Date();
      return runSessionOperation(key, async (tx, session) => {
        const claimable = await findClaimableDrafts(
          tx,
          session.id,
          input.draftIds,
          now,
        );
        if (!claimable.ok) {
          return claimable;
        }
        const claimed = await stampClaim(tx, session.id, claimable.value, now);
        return { ok: true, value: claimed };
      });
    },

    async settleClaim(key, input) {
      return runInSessionTransaction(
        (tx) => openForPublishRecord(tx, key),
        async (tx, session) => {
          const settled = await clearClaim(tx, session, input.claim, {
            status: DraftCommentStatuses.SUBMITTED,
          });
          if (input.githubReviewId !== undefined) {
            await upsertSubmittedReview(tx, session.id, input.githubReviewId);
          }
          return { ok: true, value: settled };
        },
      );
    },

    async releaseClaim(key, input) {
      return runInSessionTransaction(
        (tx) => openForPublishRecord(tx, key),
        async (tx, session) => {
          const released = await clearClaim(tx, session, input.claim, {});
          return { ok: true, value: released };
        },
      );
    },

    async preview(key) {
      // The session and the Brief are independent reads, so they go together;
      // the previous-session probe then answers BOTH "did work carry in" and
      // "is there anything to evaluate", so a first-ever session, and every
      // session that already materialized, never pays for the body parse.
      const [snapshot, facts] = await Promise.all([
        snapshotFor(key),
        readBriefCarrySlice(db, key.briefId),
      ]);
      const nothingCarried = {
        ok: true,
        value: {
          session: snapshot,
          carried: NOTHING_CARRIED,
          carriedFrom: undefined,
        },
      } as const;
      if (facts === undefined) {
        return nothingCarried;
      }
      const previous = await previousSession(db, facts, key.reviewerId);
      if (previous === undefined) {
        return nothingCarried;
      }

      const from = {
        sessionId: previous.id,
        headSha: previous.headSha,
        headIndex: previous.headIndex,
      };
      if (snapshot !== undefined) {
        // Materialized: the carry-over already sits in the session's own rows,
        // so only its source and its size are still worth reporting.
        const items = snapshot.session.carriedItemCount;
        const view = {
          session: snapshot,
          carried: NOTHING_CARRIED,
          carriedFrom: { ...from, items },
        };
        return { ok: true, value: view };
      }

      // Read before the transaction opens; the prior session's rows are read
      // together inside it, since they stay writable until materialization.
      const sessionFacts = await readSessionFacts(db, key.briefId);
      if (!sessionFacts.ok) {
        return sessionFacts;
      }
      const carried = await db.transaction((tx) =>
        evaluatePending(tx, facts, previous, sessionFacts.value),
      );
      const view = {
        session: undefined,
        carried,
        carriedFrom: { ...from, items: countPendingCarriedItems(carried) },
      };
      return { ok: true, value: view };
    },
  };
}
