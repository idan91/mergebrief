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
import { and, asc, eq, inArray } from "drizzle-orm";
import type { AppDrizzle } from "../db/handle";
import { brief } from "../schema/brief";
import { reviewDraftComment } from "../schema/review-draft-comment";
import { reviewGroupReclassification } from "../schema/review-group-reclassification";
import { reviewReadMark } from "../schema/review-read-mark";
import { reviewSession } from "../schema/review-session";
import { reviewSubmittedReview } from "../schema/review-submitted-review";
import type {
  AnchorStatus,
  BriefRowId,
  ChangeGroupCategory,
  DraftCommentSide,
  DraftCommentStatus,
  InstallationId,
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
}

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
      const sessions = await db
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
      const session = sessions[0];
      if (session === undefined) {
        return undefined;
      }
      const [draftComments, readMarks, reclassifications, submittedReviews] =
        await Promise.all([
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
        ]);
      return {
        session,
        draftComments,
        readMarks,
        reclassifications,
        submittedReviews,
      };
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
