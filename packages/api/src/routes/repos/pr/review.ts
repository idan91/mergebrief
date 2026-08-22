// POST /api/repos/:repoId/pulls/:prNumber/review — the review-submit route.
// Behind the FULL per-repo gate; posts ONE grouped formal review with the
// VIEWER's token (the reviewer authors their own review, never the App),
// carrying the drafts the SESSION holds and pinned to the head of the Brief
// the request names — the revision the reviewer read.
//
// The request carries no comments: they were saved as they were written, so
// sending them back would make two copies and a which-wins rule. On success
// the published drafts flip to `submitted` and the review id is recorded.
//
// Deliberately NOT here: the checkpoint write. The `pull_request_review`
// webhook — including the echo of this very submit — is the ONLY checkpoint
// writer, so one code path covers in-app and native github.com reviews.
//
// 422 handling: GitHub's create-review is atomic — one invalid comment 422s
// the whole review. An anchoring 422 gets ONE automatic degradation retry with
// every comment folded into the review body; nothing is silently dropped, and
// the response carries `commentsDegraded`. An unknown-commit 422 fails CLOSED
// (409, "reload") — never a retry at a different SHA.
import type { Context } from "hono";
import {
  createPullRequestReview,
  createUserOctokit,
  fetchRepositoryById,
  GitHubApiErrorCode,
  ReviewCommentSide,
  ReviewEvent,
  ReviewValidationClass,
  type CreatePullRequestReviewInput,
  type CreateReviewError,
  type ReviewCommentInput,
} from "github";
import {
  AnchorStatus,
  decryptToken,
  DraftCommentSide,
  DraftCommentStatus,
  createTenantRepository,
  type InstallationId,
  type RepoId,
  type ReviewDraftCommentRow,
  type ValueOf,
} from "persistence";
import type { Mutable, Result } from "types";
import { z } from "zod";
import { refreshSessionToken, type AuthRouteDeps } from "../../auth/session";
import type { AuthzEnv } from "../../authz";
import { ApiErrorCode, errorJson } from "../../../error-response";
import { stampAuditTarget } from "../../../product-operations/audit";
import { PRODUCT_ACTION_ID } from "../../../product-operations/ids";
import {
  productRouter,
  type ProductRouter,
} from "../../../product-operations/product-router";
import { WRITE_CLASSIFICATION } from "../../../product-operations/types";
import {
  mapWriteFailure as sessionFailure,
  resolveWrite,
} from "./session/write-resolve";
import { commitShaSchema, MAX_BODY_LENGTH } from "./wire-bounds";

// ---------------------------------------------------------------------------
// Boundary schema — the outcome and the review body. The comments come off
// the session, and the commit off the named Brief's head.
// ---------------------------------------------------------------------------

/** The FE's outcome vocabulary → GitHub's review event (1:1, never inferred). */
export const ReviewOutcome = {
  COMMENT: "comment",
  APPROVE: "approve",
  REQUEST_CHANGES: "request-changes",
} as const;
export type ReviewOutcome = ValueOf<typeof ReviewOutcome>;

const OUTCOME_TO_EVENT: Readonly<Record<ReviewOutcome, ReviewEvent>> = {
  [ReviewOutcome.COMMENT]: ReviewEvent.COMMENT,
  [ReviewOutcome.APPROVE]: ReviewEvent.APPROVE,
  [ReviewOutcome.REQUEST_CHANGES]: ReviewEvent.REQUEST_CHANGES,
};

const submitBodySchema = z
  .object({
    outcome: z.union([
      z.literal(ReviewOutcome.COMMENT),
      z.literal(ReviewOutcome.APPROVE),
      z.literal(ReviewOutcome.REQUEST_CHANGES),
    ]),
    body: z.string().max(MAX_BODY_LENGTH).optional(),
  })
  .refine(
    // GitHub documents `body` as REQUIRED for the REQUEST_CHANGES event —
    // reject deterministically here instead of surfacing GitHub's unclassified
    // 422 as a retry-looking 502.
    (submit) =>
      submit.outcome !== ReviewOutcome.REQUEST_CHANGES ||
      (submit.body !== undefined && submit.body.trim() !== ""),
    { message: "a request-changes review needs a body" },
  );

const prNumberSchema = z.coerce.number().int().positive();

/** The stored side vocabulary as GitHub names it. */
const SIDE_ON_GITHUB: Readonly<Record<DraftCommentSide, ReviewCommentSide>> = {
  [DraftCommentSide.OLD]: ReviewCommentSide.LEFT,
  [DraftCommentSide.NEW]: ReviewCommentSide.RIGHT,
};

/** One held draft as the review's comment payload. */
interface SubmitComment {
  readonly path: string;
  readonly line: number;
  readonly side: ReviewCommentSide;
  readonly startLine?: number;
  readonly startSide?: ReviewCommentSide;
  readonly body: string;
}

function shapeSubmitComment(draft: ReviewDraftCommentRow): SubmitComment {
  const comment: Mutable<SubmitComment> = {
    path: draft.filePath,
    line: draft.endLine,
    side: SIDE_ON_GITHUB[draft.side],
    body: draft.body,
  };
  // A two-side range is multi-line by definition; same-side needs the span.
  const multiLine = draft.startSide !== null || draft.startLine < draft.endLine;
  if (multiLine) {
    comment.startLine = draft.startLine;
    comment.startSide = SIDE_ON_GITHUB[draft.startSide ?? draft.side];
  }
  return comment;
}

// ---------------------------------------------------------------------------
// Degradation fold: every comment becomes a quoted block in the review body.
// ---------------------------------------------------------------------------

function foldedCommentBlock(comment: SubmitComment): string {
  const twoSide =
    comment.startSide !== undefined && comment.startSide !== comment.side;
  let range = String(comment.line);
  if (twoSide) {
    // Cross-side line numbers need their sides spelled out to mean anything.
    range = `${comment.startSide} ${comment.startLine}-${comment.side} ${comment.line}`;
  } else if (comment.startLine !== undefined) {
    range = `${comment.startLine}-${comment.line}`;
  }
  return [`**\`${comment.path}:${range}\`**`, "", comment.body].join("\n");
}

/** The review body with every anchored comment folded in as a quoted block. */
export function foldCommentsIntoBody(
  body: string | undefined,
  comments: readonly SubmitComment[],
): string {
  const preamble =
    "The comments below could not be anchored to the diff and were folded into this review body (nothing was dropped):";
  return [
    ...(body === undefined || body.trim() === "" ? [] : [body]),
    "---",
    preamble,
    ...comments.map(foldedCommentBlock),
  ].join("\n\n");
}

function toPrimitiveComments(
  comments: readonly SubmitComment[],
): ReviewCommentInput[] {
  return comments.map((comment) => ({
    path: comment.path,
    line: comment.line,
    side: comment.side,
    ...(comment.startLine === undefined
      ? {}
      : { startLine: comment.startLine }),
    ...(comment.startSide === undefined
      ? {}
      : { startSide: comment.startSide }),
    body: comment.body,
  }));
}

/** Split the gate's verified `owner/name`; `undefined` on a non-slug shape. */
function splitRepoSlug(
  fullName: string,
): { owner: string; repo: string } | undefined {
  const parts = fullName.split("/");
  const [owner, repo] = parts;
  if (
    parts.length !== 2 ||
    owner === undefined ||
    owner === "" ||
    repo === undefined ||
    repo === ""
  ) {
    return undefined;
  }
  return { owner, repo };
}

/** Decrypt a session's stored access token; `undefined` if it is unreadable. */
async function resolveSessionToken(
  deps: AuthRouteDeps,
  session: { keyRef: string; ghTokenCiphertext: string },
): Promise<string | undefined> {
  const decrypted = await decryptToken(
    deps.auth.keyProvider,
    session.keyRef,
    session.ghTokenCiphertext,
  );
  return decrypted.ok ? decrypted.value : undefined;
}

/**
 * Mount the submit route behind the pr subtree's shared gate.
 * `evictConversation` is the conversation surface's cache hook: a submitted
 * review is a conversation write, so success drops the PR's cached
 * conversation.
 */
export function reviewSubmitRoute(
  deps: AuthRouteDeps,
  evictConversation: (
    installationId: InstallationId,
    repoId: RepoId,
    prNumber: number,
  ) => void,
): ProductRouter<AuthzEnv> {
  const app = productRouter<AuthzEnv>();

  app.action(
    {
      id: PRODUCT_ACTION_ID.SUBMIT_REVIEW,
      classification: WRITE_CLASSIFICATION.EXTERNAL_WRITE,
    },
    "post",
    "/",
    async (c) => {
      const parsedBody = submitBodySchema.safeParse(
        await c.req.json().catch(() => undefined),
      );
      const parsedPr = prNumberSchema.safeParse(c.req.param("prNumber"));
      if (!parsedBody.success || !parsedPr.success) {
        return errorJson(c, ApiErrorCode.INVALID_REQUEST);
      }
      const submitBody = parsedBody.data;

      const ctx = c.get("ctx");
      const pr = await createTenantRepository(deps.handle, ctx).pullRequests.getByNumber(
        c.get("repoId"),
        parsedPr.data,
      );
      if (pr === undefined) {
        return errorJson(c, ApiErrorCode.NOT_FOUND);
      }

      // The session answers before a GitHub call is spent: a frozen tab is
      // refused here, and the drafts to publish are read off its rows.
      const resolved = await resolveWrite(deps, c);
      if (!resolved.ok) {
        return resolved.response;
      }
      const commitId = commitShaSchema.safeParse(resolved.head);
      if (!commitId.success) {
        return errorJson(c, ApiErrorCode.INVALID_REQUEST);
      }
      const held = await resolved.run(async (writer) =>
        (await writer.draftComments()).filter(
          (row) => row.status === DraftCommentStatus.DRAFT,
        ),
      );
      if (!held.ok) {
        return sessionFailure(c, held.error);
      }
      const drafts = held.value;
      // Posting an orphaned anchor lands the comment on unrelated lines;
      // dropping it reports feedback that never landed. Refused before any
      // GitHub call; re-anchoring or deleting the draft clears it.
      if (drafts.some((row) => row.anchorStatus === AnchorStatus.ORPHANED)) {
        return errorJson(c, ApiErrorCode.DRAFT_ANCHOR_ORPHANED);
      }
      const comments = drafts.map(shapeSubmitComment);
      // A neutral review with nothing in it says nothing; GitHub takes it and
      // the reviewer sees an empty review they cannot undo.
      if (
        submitBody.outcome === ReviewOutcome.COMMENT &&
        comments.length === 0 &&
        (submitBody.body ?? "").trim() === ""
      ) {
        return errorJson(c, ApiErrorCode.INVALID_REQUEST);
      }
      // Every accepted submit must be representable by its own degradation
      // path: if the anchors 422, ALL comments move into the one review body,
      // so the folded rendering has to fit GitHub's cap. Checked with the same
      // fold function, before any upstream side effect.
      if (
        comments.length > 0 &&
        foldCommentsIntoBody(submitBody.body, comments).length > MAX_BODY_LENGTH
      ) {
        return errorJson(c, ApiErrorCode.INVALID_REQUEST);
      }

      // Viewer token: set by the gate on the verified path; on a positive-cache
      // hit decrypt lazily (same pattern as the diff proxy).
      let currentSession = c.get("session");
      const resolvedToken =
        c.get("accessToken") ??
        (await resolveSessionToken(deps, currentSession));
      if (resolvedToken === undefined) {
        return errorJson(c, ApiErrorCode.UNAUTHORIZED);
      }
      // Plain `string` binding: the narrowing above doesn't survive into the
      // closures below for a mutable `let` of union type.
      let accessToken: string = resolvedToken;

      // Expired ~8h access token mid-submit → serialized refresh, at most ONCE
      // per request — shared across the fresh slug resolve, the anchored
      // attempt, AND the degradation retry (the token can expire between any of
      // them). Returns false when the budget is spent or the refresh hard-fails
      // (the orchestrator already deleted the session); the caller's 401/final
      // error mapping takes over.
      let refreshSpent = false;
      const spendRefresh = async (): Promise<boolean> => {
        if (refreshSpent) {
          return false;
        }
        refreshSpent = true;
        const refreshed = await refreshSessionToken(
          deps,
          currentSession,
          c.get("logger"),
        );
        if (!refreshed.ok) {
          return false;
        }
        currentSession = refreshed.value.session;
        accessToken = refreshed.value.accessToken;
        return true;
      };

      // Resolve the target `owner/name` FRESH by the numeric repo id, right
      // before the mutating write. The gate's cached `repoFullName` may be up
      // to 60s stale — tolerable for reads, but a rename + name-reuse inside
      // that window would point a formal REVIEW at the wrong repository.
      let repoInfo = await fetchRepositoryById(
        createUserOctokit(accessToken),
        c.get("repoId"),
      );
      if (
        !repoInfo.ok &&
        repoInfo.error.code === GitHubApiErrorCode.UNAUTHORIZED &&
        (await spendRefresh())
      ) {
        repoInfo = await fetchRepositoryById(
          createUserOctokit(accessToken),
          c.get("repoId"),
        );
      }
      if (!repoInfo.ok) {
        if (repoInfo.error.code === GitHubApiErrorCode.UNAUTHORIZED) {
          return errorJson(c, ApiErrorCode.UNAUTHORIZED);
        }
        // 403/404 both collapse to the gate's 404 posture: a viewer whose
        // access was revoked inside the positive-cache TTL must see exactly
        // what a cold gate denial shows — no existence leak, no distinguishable
        // status. Rate-limit/transport failures stay an honest 502.
        if (
          repoInfo.error.code === GitHubApiErrorCode.NOT_FOUND ||
          repoInfo.error.code === GitHubApiErrorCode.FORBIDDEN
        ) {
          return errorJson(c, ApiErrorCode.NOT_FOUND);
        }
        return errorJson(c, ApiErrorCode.GITHUB_UNAVAILABLE);
      }
      const target = splitRepoSlug(repoInfo.value.fullName);
      if (target === undefined) {
        return errorJson(c, ApiErrorCode.NOT_FOUND);
      }

      const baseInput: Omit<CreatePullRequestReviewInput, "body" | "comments"> =
        {
          owner: target.owner,
          repo: target.repo,
          prNumber: pr.prNumber,
          commitId: commitId.data,
          event: OUTCOME_TO_EVENT[submitBody.outcome],
        };
      const anchoredInput: CreatePullRequestReviewInput = {
        ...baseInput,
        ...(submitBody.body === undefined ? {} : { body: submitBody.body }),
        ...(comments.length === 0
          ? {}
          : { comments: toPrimitiveComments(comments) }),
      };

      // A 401'd POST created nothing, so a refreshed retry cannot double-post.
      const createWithRefreshOnce = async (
        input: CreatePullRequestReviewInput,
      ): Promise<Result<{ readonly reviewId: bigint }, CreateReviewError>> => {
        let result = await createPullRequestReview(
          createUserOctokit(accessToken),
          input,
        );
        if (
          !result.ok &&
          result.error.code === GitHubApiErrorCode.UNAUTHORIZED &&
          (await spendRefresh())
        ) {
          result = await createPullRequestReview(
            createUserOctokit(accessToken),
            input,
          );
        }
        return result;
      };

      let created = await createWithRefreshOnce(anchoredInput);

      // Anchoring 422 → ONE automatic degradation retry: all comments folded
      // into the body, same commitId and event. Only when there were comments —
      // a comment-free 422 has nothing to degrade.
      let commentsDegraded = false;
      if (
        !created.ok &&
        isValidation(created.error, ReviewValidationClass.INVALID_COMMENTS) &&
        comments.length > 0
      ) {
        commentsDegraded = true;
        created = await createWithRefreshOnce({
          ...baseInput,
          body: foldCommentsIntoBody(submitBody.body, comments),
        });
      }

      if (!created.ok) {
        return submitFailure(c, created.error);
      }

      // The review is on GitHub: the drafts it carried are published, and the
      // review id is what the session's own comments join on. A failure here
      // leaves drafts that are already posted — logged, never an error
      // response, which would invite a second review.
      // Nothing past this line may reach the error path: the review is live,
      // and an error response would invite a retry that posts it twice.
      stampAuditTarget(c, "pull_request", pr.id);
      try {
        const recorded = await resolved.run(async (writer) => {
          await writer.publishDraftComments(drafts.map((row) => row.id));
          await writer.recordSubmittedReview({
            githubReviewId: created.value.reviewId,
          });
        });
        if (!recorded.ok) {
          throw new Error(recorded.error.code);
        }
      } catch (bookkeepingError) {
        // Submitted to GitHub, our own record of it failed. NOT `audit.fail`:
        // the audit row is the choke point's to write, and raising that event
        // for the session's bookkeeping alerts on the wrong failure.
        c.get("logger").error("session unrecorded after a submitted review", {
          reviewId: String(created.value.reviewId),
          err: bookkeepingError,
        });
      }

      // A submitted review is a conversation write — the cached conversation
      // is stale the moment it lands.
      evictConversation(ctx.installationId, c.get("repoId"), pr.prNumber);

      return c.json(
        { reviewId: Number(created.value.reviewId), commentsDegraded },
        201,
        { "cache-control": "no-store" },
      );
    },
  );

  return app;
}

function isValidation(
  error: CreateReviewError,
  kind: ReviewValidationClass,
): boolean {
  return error.validation === kind;
}

/** Map a final create-review failure to the sanitized response posture. */
function submitFailure(
  c: Context<AuthzEnv>,
  error: CreateReviewError,
): Response {
  // Unknown commit → the PR was rewritten since it was read. Fail closed;
  // the FE tells the reviewer to reload (drafts survive via sessionStorage).
  if (isValidation(error, ReviewValidationClass.UNKNOWN_COMMIT)) {
    return errorJson(c, ApiErrorCode.PR_REWRITTEN_SINCE_READ);
  }
  // A still-unauthorized final result (refresh budget spent or hard-failed)
  // is a clean re-login prompt, not an upstream error.
  if (error.code === GitHubApiErrorCode.UNAUTHORIZED) {
    return errorJson(c, ApiErrorCode.UNAUTHORIZED);
  }
  if (error.code === GitHubApiErrorCode.NOT_FOUND) {
    return errorJson(c, ApiErrorCode.NOT_FOUND);
  }
  return errorJson(c, ApiErrorCode.GITHUB_UNAVAILABLE);
}
