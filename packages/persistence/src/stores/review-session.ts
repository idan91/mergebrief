// Tenant context filters every read and stamps every write. Reads never create sessions;
// first writes materialize them. Resolve parent ownership inside the same transaction
// and return Result errors for cross-tenant parents before any write.
import { and, asc, desc, eq, gt, gte, inArray, lt, lte, or } from "drizzle-orm";
import { AnchorStates } from "brief-core";
import type { Hop } from "brief-core/remap";
import { CommentAnchorKinds, type CommentAnchorKind } from "types";
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
  type FlagKey,
  type PreviousWork,
} from "./carry-over";
import { StoredIdsSchema } from "./artifact-store";
import type { RowScope } from "./scope";
import {
  DraftCommentStatuses,
  type AnchorStatus,
  type BriefRowId,
  type ChangeGroupCategory,
  type DispositionDecision,
  type DispositionEvidence,
  type DraftAnchor,
  type DraftCommentSide,
  type DraftCommentStatus,
  type LineDraftAnchor,
  type PullRequestRowId,
  type ReviewOutcome,
  type ReviewSessionId,
  type ReviewerId,
  type Result,
  type ValueOf,
} from "../types";

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
} as const;
export type ReviewSessionErrorCode = ValueOf<typeof ReviewSessionErrorCodes>;

export interface ReviewSessionError {
  readonly code: ReviewSessionErrorCode;
  readonly message: string;
}

type Tx = Parameters<Parameters<AppDrizzle["transaction"]>[0]>[0];

/** A read that works inside a transaction or straight off the handle. */
type Reader = Tx | AppDrizzle;

export type ReviewSessionRow = typeof reviewSession.$inferSelect;
type DraftCommentSqlRow = typeof reviewDraftComment.$inferSelect;
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

export interface DraftCommentInputBase {
  readonly reviewSessionId: ReviewSessionId;
  readonly filePath: string;
  readonly body: string;
  readonly status?: DraftCommentStatus;
  readonly anchorStatus?: AnchorStatus | null;
  readonly carriedFromSessionId?: ReviewSessionId | null;
}

export interface LineDraftCommentInput extends DraftCommentInputBase {
  readonly kind: typeof CommentAnchorKinds.LINE;
  readonly side: DraftCommentSide;
  /** Non-null only when the range genuinely crosses sides. */
  readonly startSide?: DraftCommentSide | null;
  readonly startLine: number;
  readonly endLine: number;
}

export interface FileDraftCommentInput extends DraftCommentInputBase {
  readonly kind: typeof CommentAnchorKinds.FILE;
}

export type DraftCommentInput = LineDraftCommentInput | FileDraftCommentInput;

/** `Omit` on the union would drop arm-only fields; distribute it by hand. */
type DraftCommentInsert =
  | Omit<LineDraftCommentInput, "reviewSessionId">
  | Omit<FileDraftCommentInput, "reviewSessionId">;
export type DraftCommentWrite =
  | Omit<LineDraftCommentInput, "reviewSessionId" | "carriedFromSessionId">
  | Omit<FileDraftCommentInput, "reviewSessionId" | "carriedFromSessionId">;

/**
 * An edit to a stored draft, only the named fields move. A re-anchor names
 * the coordinates AND clears `anchorStatus`: the human placed it, so the
 * carry-over's verdict on it is settled. A File comment clears the line
 * columns; a Line comment writes them.
 */
export interface DraftCommentPatch {
  readonly body?: string;
  readonly kind?: CommentAnchorKind;
  readonly filePath?: string;
  readonly side?: DraftCommentSide | null;
  readonly startSide?: DraftCommentSide | null;
  readonly startLine?: number | null;
  readonly endLine?: number | null;
  readonly anchorStatus?: AnchorStatus | null;
}

export interface ReadMarkInput {
  readonly reviewSessionId: ReviewSessionId;
  readonly chunkId: string;
}

export interface ReclassificationInput {
  readonly reviewSessionId: ReviewSessionId;
  readonly changeGroupId: string;
  readonly category: ChangeGroupCategory;
}

export interface SubmittedReviewInput {
  readonly reviewSessionId: ReviewSessionId;
  readonly githubReviewId: bigint;
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

/** What the current Brief's artifact body contributes to an evaluation. */
export interface CarryOverInputs {
  /** Change-group ids the current Brief emits. */
  readonly groupIds: readonly string[];
  /** Risk-surface flags the current Brief emits. */
  readonly flags: readonly FlagKey[];
  /** Paths the current Brief still shows; a File comment keys on these. */
  readonly filePaths: readonly string[];
}

/**
 * Resolve brief facts lazily: only a previous-session evaluation needs the expensive body parse.
 * The storage layer otherwise treats the artifact as opaque.
 */
export interface CarryOverQuery extends ReviewSessionKey {
  readonly brief: () => Promise<CarryOverInputs>;
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

/**
 * The owned writes, bound to one session inside the materialization
 * transaction. They throw rather than return `Result`: the parents are
 * already resolved and the transaction is open, so a failure here is an infra
 * error and must take the whole transaction down with it.
 */
export interface SessionWriter {
  readonly session: ReviewSessionRow;
  /**
   * The carry-over source is NOT the caller's to name: the copy sets it from
   * the session it read, which is tenant-filtered. Accepting it here would
   * take an unchecked `review_session` id inside an open transaction.
   */
  addDraftComment(input: DraftCommentWrite): Promise<ReviewDraftCommentRow>;
  /**
   * Edit a draft this session holds, its own row, or the copy of a carried
   * one named by the id it was copied from. `undefined` when it holds neither.
   */
  updateDraftComment(
    id: bigint,
    patch: DraftCommentPatch,
  ): Promise<ReviewDraftCommentRow | undefined>;
  /** Drop such a draft, returning the row that went; `undefined` when none did. */
  deleteDraftComment(id: bigint): Promise<bigint | undefined>;
  /** Every draft this session holds, published ones included, oldest first. */
  draftComments(): Promise<readonly ReviewDraftCommentRow[]>;
  /** Flip drafts to `submitted`, what publishing them to GitHub records here. */
  publishDraftComments(ids: readonly bigint[]): Promise<void>;
  putReadMark(
    input: Omit<ReadMarkInput, "reviewSessionId">,
  ): Promise<ReviewReadMarkRow>;
  /** Drop a Chunk's read mark, if any, the unread half of `set-chunk-read`. */
  clearReadMark(chunkId: string): Promise<void>;
  putReclassification(
    input: Omit<ReclassificationInput, "reviewSessionId">,
  ): Promise<ReviewGroupReclassificationRow>;
  recordSubmittedReview(
    input: Omit<SubmittedReviewInput, "reviewSessionId">,
  ): Promise<ReviewSubmittedReviewRow>;
  /** Record a decision on a risk flag; idempotent on its anchor. */
  putDisposition(input: DispositionInput): Promise<DispositionRow>;
  /**
   * Undo a decision, the flag goes back to undecided, which is a row that
   * does not exist. `false` when this session held none. Idempotent.
   */
  deleteDisposition(anchor: DispositionAnchor): Promise<boolean>;
  /** The provisional submit verdict. Never carried, a new session starts over. */
  setReviewOutcome(outcome: ReviewOutcome): Promise<ReviewSessionRow>;
}

export interface ReviewSessionRepository {
  /** Read by key. Absence is a normal `undefined`, never a create. */
  get(key: ReviewSessionKey): Promise<ReviewSessionSnapshot | undefined>;
  /**
   * Run `write` as the session's write, materializing the session and its
   * carry-over first if this is the first one, all in ONE transaction. Any
   * write operation can be the one that writes; no read ever is.
   * `sessionFrozen` when the reviewer already works on a newer Brief.
   */
  writeToSession<T>(
    query: CarryOverQuery,
    write: (writer: SessionWriter) => Promise<T>,
  ): Promise<Result<T, ReviewSessionError>>;
  /**
   * The session as it stands plus, while it does not exist yet, the previous
   * session's work re-placed onto this Brief. Creates NOTHING, the verdicts
   * become rows only when the reviewer writes.
   */
  preview(query: CarryOverQuery): Promise<ReviewSessionView>;
}

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
    if (step.headIndex <= fromHeadIndex) continue;
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
    if (step === undefined || adjacent === undefined) return false;
    if (step.headIndex <= fromHeadIndex) continue;
    if (step.anchorState !== AnchorStates.ANCHORED) return false;
    if (step.headSha === adjacent.headSha) return false;
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

/**
 * The inserts as the repository itself uses them, it may name a carry-over
 * source because it resolves that session in the same transaction first. The
 * public `SessionWriter` narrows the field away.
 */
interface SessionInserts extends Omit<
  SessionWriter,
  "session" | "addDraftComment"
> {
  addDraftComment(input: DraftCommentInsert): Promise<ReviewDraftCommentRow>;
}

/** The one row a `.returning()` insert owes; its absence is an infra error. */
function only<TRow>(rows: TRow[], subject: string): TRow {
  const row = rows[0];
  if (row === undefined) throw new Error(`${subject} write returned no row`);
  return row;
}

function isFileDraftCommentInput(
  input: DraftCommentInsert,
): input is Omit<FileDraftCommentInput, "reviewSessionId"> {
  return input.kind === CommentAnchorKinds.FILE;
}

function draftAnchorFromInsert(input: DraftCommentInsert): DraftAnchor {
  if (isFileDraftCommentInput(input)) {
    return { kind: CommentAnchorKinds.FILE, file: input.filePath };
  }
  if (input.startSide !== undefined && input.startSide !== null) {
    return {
      kind: CommentAnchorKinds.LINE,
      file: input.filePath,
      side: input.side,
      startLine: input.startLine,
      endLine: input.endLine,
      startSide: input.startSide,
    };
  }
  return {
    kind: CommentAnchorKinds.LINE,
    file: input.filePath,
    side: input.side,
    startLine: input.startLine,
    endLine: input.endLine,
  };
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

function normalizeDraftCommentPatch(
  patch: DraftCommentPatch,
): DraftCommentPatch {
  if (patch.kind !== CommentAnchorKinds.FILE) return patch;
  return {
    ...patch,
    side: null,
    startSide: null,
    startLine: null,
    endLine: null,
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
    createdAt: row.createdAt,
  };
}

function fail(
  code: ReviewSessionErrorCode,
  message: string,
): Result<never, ReviewSessionError> {
  return { ok: false, error: { code, message } };
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
    if (heads.length < 2) return assembleHops(heads, []);
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
   * Re-evaluate inside materialization rather than trusting a read payload, preserving late writes.
   * Resolve the artifact beforehand: its thunk reads through this same handle and would
   * deadlock inside a transaction on a single-connection database.
   */
  async function evaluatePending(
    tx: Reader,
    facts: BriefFacts,
    previous: PreviousSession,
    artifact: CarryOverInputs,
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
      groupIds: artifact.groupIds,
      flags: artifact.flags,
      filePaths: artifact.filePaths,
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

  /** The owned writes, bound to one open transaction and one session id. */
  function insertsForSession(
    tx: Tx,
    sessionId: ReviewSessionId,
  ): SessionInserts {
    return {
      async addDraftComment(input) {
        const values: typeof reviewDraftComment.$inferInsert = {
          installationId: scope.installationId,
          reviewSessionId: sessionId,
          ...shapeDraftCommentValues(draftAnchorFromInsert(input)),
          body: input.body,
          anchorStatus: input.anchorStatus ?? null,
          carriedFromSessionId: input.carriedFromSessionId ?? null,
        };

        if (input.status !== undefined) values.status = input.status;

        return parseDraftCommentRow(
          only(
            await tx.insert(reviewDraftComment).values(values).returning(),
            "review_draft_comment",
          ),
        );
      },
      async updateDraftComment(id, patch) {
        const rows = await tx
          .update(reviewDraftComment)
          .set(normalizeDraftCommentPatch(patch))
          .where(addressedDraft(sessionId, id))
          .returning();
        const row = rows[0];
        return row === undefined ? undefined : parseDraftCommentRow(row);
      },
      async deleteDraftComment(id) {
        const rows = await tx
          .delete(reviewDraftComment)
          .where(addressedDraft(sessionId, id))
          .returning({ id: reviewDraftComment.id });
        return rows[0]?.id;
      },
      async draftComments() {
        const rows = await tx
          .select()
          .from(reviewDraftComment)
          .where(ownedBy(sessionId))
          .orderBy(asc(reviewDraftComment.id));
        return rows.map(parseDraftCommentRow);
      },
      async publishDraftComments(ids) {
        if (ids.length === 0) return;
        await tx
          .update(reviewDraftComment)
          .set({ status: DraftCommentStatuses.SUBMITTED })
          .where(
            and(ownedBy(sessionId), inArray(reviewDraftComment.id, [...ids])),
          );
      },
      async putReadMark(input) {
        return only(
          await tx
            .insert(reviewReadMark)
            .values({
              installationId: scope.installationId,
              reviewSessionId: sessionId,
              chunkId: input.chunkId,
            })
            .onConflictDoUpdate({
              target: [reviewReadMark.reviewSessionId, reviewReadMark.chunkId],
              set: { chunkId: input.chunkId },
            })
            .returning(),
          "review_read_mark",
        );
      },
      async clearReadMark(chunkId) {
        await tx
          .delete(reviewReadMark)
          .where(
            and(
              eq(reviewReadMark.chunkId, chunkId),
              and(
                scope.matchesWorld(reviewReadMark.installationId),
                eq(reviewReadMark.reviewSessionId, sessionId),
              ),
            ),
          );
      },
      async putReclassification(input) {
        return only(
          await tx
            .insert(reviewGroupReclassification)
            .values({
              installationId: scope.installationId,
              reviewSessionId: sessionId,
              changeGroupId: input.changeGroupId,
              category: input.category,
            })
            .onConflictDoUpdate({
              target: [
                reviewGroupReclassification.reviewSessionId,
                reviewGroupReclassification.changeGroupId,
              ],
              set: { category: input.category },
            })
            .returning(),
          "review_group_reclassification",
        );
      },
      async putDisposition(input) {
        return only(
          await tx
            .insert(disposition)
            .values({
              installationId: scope.installationId,
              reviewSessionId: sessionId,
              filePath: input.filePath,
              attribute: input.attribute,
              regionStart: input.regionStart,
              regionEnd: input.regionEnd,
              decision: input.decision,
              reason: input.reason ?? null,
              evidenceKind: input.evidence?.kind ?? null,
              evidenceRef: input.evidence?.ref ?? null,
              decidedAt: new Date(),
            })
            .onConflictDoUpdate({
              target: [
                disposition.reviewSessionId,
                disposition.filePath,
                disposition.attribute,
                disposition.regionStart,
                disposition.regionEnd,
              ],
              set: {
                decision: input.decision,
                reason: input.reason ?? null,
                evidenceKind: input.evidence?.kind ?? null,
                evidenceRef: input.evidence?.ref ?? null,
                // Deciding here settles both questions the carry brought over,
                // the re-look AND the evidence the old decision lost.
                carryStatus: null,
                evidenceStatus: null,
                decidedAt: new Date(),
              },
            })
            .returning(),
          "disposition",
        );
      },
      async deleteDisposition(anchor) {
        const gone = await tx
          .delete(disposition)
          .where(
            and(
              scope.matchesWorld(disposition.installationId),
              eq(disposition.reviewSessionId, sessionId),
              eq(disposition.filePath, anchor.filePath),
              eq(disposition.attribute, anchor.attribute),
              eq(disposition.regionStart, anchor.regionStart),
              eq(disposition.regionEnd, anchor.regionEnd),
            ),
          )
          .returning({ id: disposition.id });
        return gone.length > 0;
      },
      async setReviewOutcome(outcome) {
        return only(
          await tx
            .update(reviewSession)
            .set({ reviewOutcome: outcome })
            .where(
              and(
                scope.matchesWorld(reviewSession.installationId),
                eq(reviewSession.id, sessionId),
              ),
            )
            .returning(),
          "review_session",
        );
      },
      async recordSubmittedReview(input) {
        return only(
          await tx
            .insert(reviewSubmittedReview)
            .values({
              installationId: scope.installationId,
              reviewSessionId: sessionId,
              githubReviewId: input.githubReviewId,
            })
            .onConflictDoUpdate({
              target: [
                reviewSubmittedReview.reviewSessionId,
                reviewSubmittedReview.githubReviewId,
              ],
              set: { githubReviewId: input.githubReviewId },
            })
            .returning(),
          "review_submitted_review",
        );
      },
    };
  }

  /** The materialization transaction's writer: the inserts plus its session. */
  function sessionWriter(tx: Tx, session: ReviewSessionRow): SessionWriter {
    return { session, ...insertsForSession(tx, session.id) };
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

  /** The session row inside an open transaction; its existence is settled. */
  async function sessionInTx(
    tx: Tx,
    key: ReviewSessionKey,
  ): Promise<ReviewSessionRow> {
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
      .limit(1);
    const row = rows[0];
    if (row === undefined) {
      throw new Error("review_session vanished inside its own transaction");
    }
    return row;
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
   * The Brief facts a materialization would evaluate against, or `undefined`
   * when there is nothing to evaluate, the session already exists, or it is
   * the reviewer's first on this PR. Both skip the Brief-body parse entirely.
   */
  async function deriveCarryOverInputs(
    query: CarryOverQuery,
  ): Promise<CarryOverInputs | undefined> {
    if ((await findSession(query)) !== undefined) {
      return undefined;
    }
    const facts = await readBriefCarrySlice(db, query.briefId);
    if (facts === undefined) {
      return undefined;
    }
    const previous = await previousSession(db, facts, query.reviewerId);
    return previous === undefined ? undefined : query.brief();
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

  return {
    async get(key) {
      return snapshotFor(key);
    },

    async writeToSession(query, write) {
      // Resolve the thunk before opening the transaction to avoid single-connection deadlock.
      // First-ever sessions skip the expensive brief parse because they have nothing to evaluate.
      const artifact = await deriveCarryOverInputs(query);
      return db.transaction(async (tx) => {
        const facts = await readBriefCarrySlice(tx, query.briefId);
        if (facts === undefined) {
          return fail(
            ReviewSessionErrorCodes.PARENT_NOT_IN_TENANT,
            `brief ${query.briefId} not in ${scope.label}`,
          );
        }
        if (await hasNewerSession(tx, facts, query.reviewerId)) {
          return fail(
            ReviewSessionErrorCodes.SESSION_FROZEN,
            `reviewer ${query.reviewerId} already works on a newer brief of pull_request ${facts.pullRequestId}`,
          );
        }
        // DO NOTHING is the creation detector: a second concurrent first-write
        // gets no row back, skips the copy and goes straight to its own write.
        // Only the creating writer copies, so carried rows never double.
        const inserted = await tx
          .insert(reviewSession)
          .values({
            installationId: scope.installationId,
            briefId: query.briefId,
            reviewerId: query.reviewerId,
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
        if (created !== undefined) {
          // Re-read inside the transaction: the payload the read returned is
          // never trusted, which is what makes a late write to the previous
          // session safe with no lock and no version token.
          const previous = await previousSession(tx, facts, query.reviewerId);
          if (previous !== undefined) {
            if (artifact === undefined) {
              // The probe lost a race, a concurrent first write on an older
              // Brief created this session. Failing is deliberate: carry-over
              // cannot be re-evaluated inside the open transaction, and
              // skipping it writes without the carried work for good.
              throw new Error(
                "previous review_session appeared before the first write",
              );
            }
            const carried = await evaluatePending(
              tx,
              facts,
              previous,
              artifact,
            );
            await copyCarried(tx, created, carried, previous.id);
            // Stamped here and never recomputed: the receipt states what came
            // across, and every marker it could be re-derived from is one the
            // reviewer's own later work clears.
            await tx
              .update(reviewSession)
              .set({ carriedItemCount: countPendingCarriedItems(carried) })
              .where(eq(reviewSession.id, created.id));
          }
        }
        const session = created ?? (await sessionInTx(tx, query));
        return { ok: true, value: await write(sessionWriter(tx, session)) };
      });
    },

    async preview(query) {
      // The session and the Brief are independent reads, so they go together;
      // the previous-session probe then answers BOTH "did work carry in" and
      // "is there anything to evaluate", so a first-ever session, and every
      // session that already materialized, never pays for the body parse.
      const [snapshot, facts] = await Promise.all([
        snapshotFor(query),
        readBriefCarrySlice(db, query.briefId),
      ]);
      if (facts === undefined) {
        return {
          session: snapshot,
          carried: NOTHING_CARRIED,
          carriedFrom: undefined,
        };
      }
      const previous = await previousSession(db, facts, query.reviewerId);
      if (previous === undefined) {
        return {
          session: snapshot,
          carried: NOTHING_CARRIED,
          carriedFrom: undefined,
        };
      }
      const from = {
        sessionId: previous.id,
        headSha: previous.headSha,
        headIndex: previous.headIndex,
      };
      if (snapshot !== undefined) {
        // Materialized: the carry-over already sits in the session's own rows,
        // so only its source and its size are still worth reporting.
        return {
          session: snapshot,
          carried: NOTHING_CARRIED,
          carriedFrom: {
            ...from,
            items: snapshot.session.carriedItemCount,
          },
        };
      }
      // Resolve the brief-body thunk before the transaction to avoid single-connection deadlock.
      // Read prior-session rows together inside it; they remain writable until materialization.
      const artifact = await query.brief();
      const carried = await db.transaction((tx) =>
        evaluatePending(tx, facts, previous, artifact),
      );
      return {
        session: undefined,
        carried,
        carriedFrom: { ...from, items: countPendingCarriedItems(carried) },
      };
    },
  };
}
