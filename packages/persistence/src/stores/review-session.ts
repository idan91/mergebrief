// The Review Session surface — the reviewer's private work on one Brief.
// Reached through `forTenant(db, ctx).reviewSessions`, so it obeys the same
// containment rules as every other store: `ctx` is the one place an
// `installation_id` enters, every read filters on it and every write stamps
// it.
//
// Two rules this file exists to enforce:
//   (a) there is no Begin operation — `upsert` is idempotent on
//       (installation_id, brief_id, reviewer_id), so the first write creates
//       the session and `get` never creates anything;
//   (b) a write naming a parent (`brief` for the session, `review_session`
//       for an owned row) resolves that parent within ctx's tenant in the
//       SAME transaction — a parent in another tenant yields a Result error,
//       never a DB write.
import { and, asc, desc, eq, gte, inArray, lt, lte } from "drizzle-orm";
import type { Hop } from "brief-core/remap";
import type { AppDrizzle } from "../db/handle";
import { brief } from "../schema/brief";
import { disposition } from "../schema/disposition";
import { hunkSpan } from "../schema/hunk-span";
import { reviewDraftComment } from "../schema/review-draft-comment";
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
import { ChunkIdsSchema } from "./carry-over";
import type {
  AnchorStatus,
  BriefRowId,
  ChangeGroupCategory,
  DraftCommentSide,
  DraftCommentStatus,
  InstallationId,
  PullRequestRowId,
  ReviewOutcome,
  ReviewSessionId,
  ReviewerId,
  Result,
  ValueOf,
} from "../types";

// ---------------------------------------------------------------------------
// Errors — expected failures. Programmer errors still `throw`. Owned here
// rather than borrowed from `tenant.ts`, which composes this module.
// ---------------------------------------------------------------------------

export const ReviewSessionErrorCode = {
  /** A write named a `brief` or `review_session` outside ctx's tenant. */
  PARENT_NOT_IN_TENANT: "parent-not-in-tenant",
} as const;
export type ReviewSessionErrorCode = ValueOf<typeof ReviewSessionErrorCode>;

export interface ReviewSessionError {
  readonly code: ReviewSessionErrorCode;
  readonly message: string;
}

type Tx = Parameters<Parameters<AppDrizzle["transaction"]>[0]>[0];

export type ReviewSessionRow = typeof reviewSession.$inferSelect;
export type ReviewDraftCommentRow = typeof reviewDraftComment.$inferSelect;
export type ReviewReadMarkRow = typeof reviewReadMark.$inferSelect;
export type ReviewGroupReclassificationRow =
  typeof reviewGroupReclassification.$inferSelect;
export type ReviewSubmittedReviewRow =
  typeof reviewSubmittedReview.$inferSelect;
export type DispositionRow = typeof disposition.$inferSelect;

/** The session key — a Brief and the reviewer working against it. */
export interface ReviewSessionKey {
  readonly briefId: BriefRowId;
  readonly reviewerId: ReviewerId;
}

export interface ReviewSessionUpsertInput extends ReviewSessionKey {
  /** Omitted leaves the stored outcome (or the `comment` default) alone. */
  readonly reviewOutcome?: ReviewOutcome;
}

export interface DraftCommentInput {
  readonly reviewSessionId: ReviewSessionId;
  readonly filePath: string;
  readonly side: DraftCommentSide;
  readonly startLine: number;
  readonly endLine: number;
  readonly body: string;
  readonly status?: DraftCommentStatus;
  readonly anchorStatus?: AnchorStatus | null;
  readonly carriedFromSessionId?: ReviewSessionId | null;
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

/**
 * The session and everything it owns — one read, no writes. Every list is
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

/**
 * A session read, plus what the reviewer's previous session would contribute
 * if they wrote. `groupIds` and `flags` come from the Brief artifact, which
 * this layer stores opaquely — the caller reads them off the body it already
 * has.
 */
export interface CarryOverQuery extends ReviewSessionKey {
  /** Change-group ids the current Brief emits. */
  readonly groupIds: readonly string[];
  /** Risk-surface flags the current Brief emits. */
  readonly flags: readonly FlagKey[];
}

export interface ReviewSessionView {
  /** Present once the session materialized; its rows then hold the carry-over. */
  readonly session: ReviewSessionSnapshot | undefined;
  /** Evaluated in memory — nothing here exists as a row yet. */
  readonly carried: CarriedWork;
  readonly carriedFromSessionId: ReviewSessionId | undefined;
}

export interface ReviewSessionRepository {
  /**
   * Idempotent create-or-fetch on the session key — the first write of a
   * session, since there is no explicit Begin. `parentNotInTenant` when the
   * named `brief` is not in ctx's tenant.
   */
  upsert(
    input: ReviewSessionUpsertInput,
  ): Promise<Result<ReviewSessionRow, ReviewSessionError>>;
  /** Read by key. Absence is a normal `undefined` — never a create. */
  get(key: ReviewSessionKey): Promise<ReviewSessionSnapshot | undefined>;
  /** Append a draft comment. Addressed by its row id thereafter. */
  addDraftComment(
    input: DraftCommentInput,
  ): Promise<Result<ReviewDraftCommentRow, ReviewSessionError>>;
  /** Mark a Chunk read; idempotent on (session, chunk). */
  putReadMark(
    input: ReadMarkInput,
  ): Promise<Result<ReviewReadMarkRow, ReviewSessionError>>;
  /** Override a Change group's category; idempotent on (session, group). */
  putReclassification(
    input: ReclassificationInput,
  ): Promise<Result<ReviewGroupReclassificationRow, ReviewSessionError>>;
  /** Record a submitted GitHub review id; idempotent on (session, review). */
  recordSubmittedReview(
    input: SubmittedReviewInput,
  ): Promise<Result<ReviewSubmittedReviewRow, ReviewSessionError>>;
  /**
   * The session as it stands plus, while it does not exist yet, the previous
   * session's work re-placed onto this Brief. Creates NOTHING — the verdicts
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
}

/**
 * The chunk ids that survived EVERY step from the previous session's Brief to
 * this one. `carried_chunk_ids` names what one Brief took from its immediate
 * predecessor, so a single-hop read of the newest Brief would accept an id
 * that a re-minted chunk merely reused two pushes ago. The intersection is
 * what makes the id mean the same chunk the reviewer actually opened.
 */
function carriedThroughChain(
  chain: readonly ChainBrief[],
  fromHeadIndex: number,
): string[] {
  let survivors: Set<string> | undefined;
  for (const step of chain) {
    if (step.headIndex <= fromHeadIndex) continue;
    const parsed = ChunkIdsSchema.safeParse(step.carriedChunkIds);
    const carried = new Set(parsed.success ? parsed.data : []);
    survivors =
      survivors === undefined
        ? carried
        : new Set([...survivors].filter((id) => carried.has(id)));
  }
  return survivors === undefined ? [] : [...survivors];
}

/** The reviewer's previous session and the Brief it sat on. */
interface PreviousSession {
  readonly id: ReviewSessionId;
  readonly baseSha: string;
  readonly headIndex: number;
}

const NOTHING_PENDING = {
  carried: NOTHING_CARRIED,
  carriedFromSessionId: undefined,
} as const;

function fail(
  code: ReviewSessionErrorCode,
  message: string,
): Result<never, ReviewSessionError> {
  return { ok: false, error: { code, message } };
}

/**
 * Build the Review Session repository. Not exported from `index.ts` on its
 * own — `forTenant` composes it, so a caller cannot reach it without a ctx.
 */
export function reviewSessionRepository(
  db: AppDrizzle,
  installationId: InstallationId,
): ReviewSessionRepository {
  /** Rule (b) for the session itself: the Brief must be in ctx's tenant. */
  async function briefInTenant(tx: Tx, briefId: BriefRowId): Promise<boolean> {
    const rows = await tx
      .select({ id: brief.id })
      .from(brief)
      .where(
        and(eq(brief.installationId, installationId), eq(brief.id, briefId)),
      )
      .limit(1);
    return rows[0] !== undefined;
  }

  /**
   * Rule (b) for owned rows: every session id the write names — the owning
   * one and any `carried_from` reference — must be in ctx's tenant. Returns
   * the first that is not.
   */
  async function foreignSession(
    tx: Tx,
    ids: readonly ReviewSessionId[],
  ): Promise<ReviewSessionId | undefined> {
    const rows = await tx
      .select({ id: reviewSession.id })
      .from(reviewSession)
      .where(
        and(
          eq(reviewSession.installationId, installationId),
          inArray(reviewSession.id, [...ids]),
        ),
      );
    const inTenant = new Set(rows.map((row) => row.id));
    return ids.find((id) => !inTenant.has(id));
  }

  /** Every owned write shares this shape: verify the parents, then write. */
  async function writeOwned<TRow>(
    sessionIds: readonly ReviewSessionId[],
    write: (tx: Tx) => Promise<TRow[]>,
    subject: string,
  ): Promise<Result<TRow, ReviewSessionError>> {
    return db.transaction(async (tx) => {
      const foreign = await foreignSession(tx, sessionIds);
      if (foreign !== undefined) {
        return fail(
          ReviewSessionErrorCode.PARENT_NOT_IN_TENANT,
          `review_session ${foreign} not in tenant ${installationId}`,
        );
      }
      const rows = await write(tx);
      const row = rows[0];
      if (row === undefined) {
        throw new Error(`${subject} write returned no row`);
      }
      return { ok: true, value: row };
    });
  }

  /** The current Brief's own contribution to an evaluation. */
  async function briefFacts(
    tx: Tx,
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
        and(eq(brief.installationId, installationId), eq(brief.id, briefId)),
      )
      .limit(1);
    return rows[0];
  }

  /** The reviewer's newest session on an OLDER Brief of the same PR. */
  async function previousSession(
    tx: Tx,
    facts: BriefFacts,
    reviewerId: ReviewerId,
  ): Promise<PreviousSession | undefined> {
    const rows = await tx
      .select({
        id: reviewSession.id,
        baseSha: brief.baseSha,
        headIndex: brief.headIndex,
      })
      .from(reviewSession)
      .innerJoin(brief, eq(reviewSession.briefId, brief.id))
      .where(
        and(
          eq(reviewSession.installationId, installationId),
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
   * first — the chain both the hops and the carried chunk set are read off.
   */
  async function chainBriefs(
    tx: Tx,
    facts: BriefFacts,
    fromHeadIndex: number,
  ): Promise<ChainBrief[]> {
    return tx
      .select({
        headSha: brief.headSha,
        headIndex: brief.headIndex,
        carriedChunkIds: brief.carriedChunkIds,
      })
      .from(brief)
      .where(
        and(
          eq(brief.installationId, installationId),
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
    tx: Tx,
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
          eq(hunkSpan.installationId, installationId),
          eq(hunkSpan.pullRequestId, facts.pullRequestId),
          inArray(hunkSpan.baselineSha, heads.slice(0, -1)),
          inArray(hunkSpan.headSha, heads.slice(1)),
        ),
      );
    return assembleHops(heads, rows);
  }

  /** The previous session's rows, reduced to what the evaluation reads. */
  async function previousWork(
    tx: Tx,
    sessionId: ReviewSessionId,
  ): Promise<PreviousWork> {
    const [comments, marks, reclassifications, dispositions] =
      await Promise.all([
        tx
          .select({
            filePath: reviewDraftComment.filePath,
            side: reviewDraftComment.side,
            startLine: reviewDraftComment.startLine,
            endLine: reviewDraftComment.endLine,
            body: reviewDraftComment.body,
            status: reviewDraftComment.status,
          })
          .from(reviewDraftComment)
          .where(
            and(
              eq(reviewDraftComment.installationId, installationId),
              eq(reviewDraftComment.reviewSessionId, sessionId),
            ),
          )
          .orderBy(asc(reviewDraftComment.id)),
        tx
          .select({ chunkId: reviewReadMark.chunkId })
          .from(reviewReadMark)
          .where(
            and(
              eq(reviewReadMark.installationId, installationId),
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
              eq(reviewGroupReclassification.installationId, installationId),
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
            decidedAt: disposition.decidedAt,
          })
          .from(disposition)
          .where(
            and(
              eq(disposition.installationId, installationId),
              eq(disposition.reviewSessionId, sessionId),
            ),
          )
          .orderBy(asc(disposition.id)),
      ]);
    return {
      draftComments: comments,
      readMarks: marks.map((mark) => mark.chunkId),
      reclassifications,
      dispositions,
    };
  }

  /**
   * The verdicts for a session that does not exist yet. Runs on every read
   * AND again inside the materialization transaction — the payload a read
   * returned is never trusted, which is what makes the late write to the old
   * session safe with no lock and no version token.
   */
  async function evaluatePending(
    tx: Tx,
    query: CarryOverQuery,
  ): Promise<{
    carried: CarriedWork;
    carriedFromSessionId: ReviewSessionId | undefined;
  }> {
    const facts = await briefFacts(tx, query.briefId);
    if (facts === undefined) return NOTHING_PENDING;
    const previous = await previousSession(tx, facts, query.reviewerId);
    if (previous === undefined) return NOTHING_PENDING;
    const chain = await chainBriefs(tx, facts, previous.headIndex);
    const heads = chain.map((row) => row.headSha);
    const [work, hops] = await Promise.all([
      previousWork(tx, previous.id),
      hopChain(tx, facts, heads),
    ]);
    return {
      carried: evaluateCarryOver(work, {
        carriedChunkIds: carriedThroughChain(chain, previous.headIndex),
        groupIds: query.groupIds,
        flags: query.flags,
        hops,
        baseShaMoved: previous.baseSha !== facts.baseSha,
      }),
      carriedFromSessionId: previous.id,
    };
  }

  /** The session row for a key, or `undefined` — never a create. */
  async function findSession(
    key: ReviewSessionKey,
  ): Promise<ReviewSessionRow | undefined> {
    const rows = await db
      .select()
      .from(reviewSession)
      .where(
        and(
          eq(reviewSession.installationId, installationId),
          eq(reviewSession.briefId, key.briefId),
          eq(reviewSession.reviewerId, key.reviewerId),
        ),
      )
      .limit(1);
    return rows[0];
  }

  /** The session and everything it owns, or `undefined` — never a create. */
  async function snapshotFor(
    key: ReviewSessionKey,
  ): Promise<ReviewSessionSnapshot | undefined> {
    const session = await findSession(key);
    if (session === undefined) {
      return undefined;
    }
    const [
      draftComments,
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
            eq(reviewDraftComment.installationId, installationId),
            eq(reviewDraftComment.reviewSessionId, session.id),
          ),
        )
        .orderBy(asc(reviewDraftComment.id)),
      db
        .select()
        .from(reviewReadMark)
        .where(
          and(
            eq(reviewReadMark.installationId, installationId),
            eq(reviewReadMark.reviewSessionId, session.id),
          ),
        )
        .orderBy(asc(reviewReadMark.id)),
      db
        .select()
        .from(reviewGroupReclassification)
        .where(
          and(
            eq(reviewGroupReclassification.installationId, installationId),
            eq(reviewGroupReclassification.reviewSessionId, session.id),
          ),
        )
        .orderBy(asc(reviewGroupReclassification.id)),
      db
        .select()
        .from(reviewSubmittedReview)
        .where(
          and(
            eq(reviewSubmittedReview.installationId, installationId),
            eq(reviewSubmittedReview.reviewSessionId, session.id),
          ),
        )
        .orderBy(asc(reviewSubmittedReview.id)),
      db
        .select()
        .from(disposition)
        .where(
          and(
            eq(disposition.installationId, installationId),
            eq(disposition.reviewSessionId, session.id),
          ),
        )
        .orderBy(asc(disposition.id)),
    ]);
    return {
      session,
      draftComments,
      readMarks,
      reclassifications,
      submittedReviews,
      dispositions,
    };
  }

  return {
    async upsert(input) {
      return db.transaction(async (tx) => {
        if (!(await briefInTenant(tx, input.briefId))) {
          return fail(
            ReviewSessionErrorCode.PARENT_NOT_IN_TENANT,
            `brief ${input.briefId} not in tenant ${installationId}`,
          );
        }
        const rows = await tx
          .insert(reviewSession)
          .values({
            installationId,
            briefId: input.briefId,
            reviewerId: input.reviewerId,
            ...(input.reviewOutcome === undefined
              ? {}
              : { reviewOutcome: input.reviewOutcome }),
          })
          .onConflictDoUpdate({
            target: [
              reviewSession.installationId,
              reviewSession.briefId,
              reviewSession.reviewerId,
            ],
            // An outcome-less upsert must still return the existing row, so
            // the conflict path updates the key back onto itself.
            set: {
              reviewerId: input.reviewerId,
              ...(input.reviewOutcome === undefined
                ? {}
                : { reviewOutcome: input.reviewOutcome }),
            },
          })
          .returning();
        const row = rows[0];
        if (row === undefined) {
          throw new Error("review_session upsert returned no row");
        }
        return { ok: true, value: row };
      });
    },

    async get(key) {
      return snapshotFor(key);
    },

    async preview(query) {
      const snapshot = await snapshotFor(query);
      if (snapshot !== undefined) {
        // Materialized: the carry-over already sits in the session's own rows.
        return {
          session: snapshot,
          carried: NOTHING_CARRIED,
          carriedFromSessionId: undefined,
        };
      }
      const pending = await db.transaction((tx) => evaluatePending(tx, query));
      return { session: undefined, ...pending };
    },

    async addDraftComment(input) {
      const carriedFrom = input.carriedFromSessionId ?? null;
      return writeOwned(
        carriedFrom === null
          ? [input.reviewSessionId]
          : [input.reviewSessionId, carriedFrom],
        (tx) =>
          tx
            .insert(reviewDraftComment)
            .values({
              installationId,
              reviewSessionId: input.reviewSessionId,
              filePath: input.filePath,
              side: input.side,
              startLine: input.startLine,
              endLine: input.endLine,
              body: input.body,
              ...(input.status === undefined ? {} : { status: input.status }),
              anchorStatus: input.anchorStatus ?? null,
              carriedFromSessionId: carriedFrom,
            })
            .returning(),
        "review_draft_comment",
      );
    },

    async putReadMark(input) {
      return writeOwned(
        [input.reviewSessionId],
        (tx) =>
          tx
            .insert(reviewReadMark)
            .values({
              installationId,
              reviewSessionId: input.reviewSessionId,
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

    async putReclassification(input) {
      return writeOwned(
        [input.reviewSessionId],
        (tx) =>
          tx
            .insert(reviewGroupReclassification)
            .values({
              installationId,
              reviewSessionId: input.reviewSessionId,
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

    async recordSubmittedReview(input) {
      return writeOwned(
        [input.reviewSessionId],
        (tx) =>
          tx
            .insert(reviewSubmittedReview)
            .values({
              installationId,
              reviewSessionId: input.reviewSessionId,
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
