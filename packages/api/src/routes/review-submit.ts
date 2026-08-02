// POST /api/repos/:repoId/pulls/:prNumber/review — the review-submit route
// (BRIEF-23 PR 2). Behind the FULL per-repo gate; posts ONE grouped formal
// review with the VIEWER's token (ADR 0016 #4 — the reviewer authors their own
// review, never the App), pinned to the commitId the reviewer actually read.
//
// Deliberately NOT here: the checkpoint write. The `pull_request_review`
// webhook — including the echo of this very submit — is the ONLY checkpoint
// writer (grill-locked #1), so one code path covers in-app and native
// github.com reviews. This route posts the review and emits the `submit`
// audit row; nothing else.
//
// 422 handling (grill-locked #3/#6): GitHub's create-review is atomic — one
// invalid comment 422s the whole review. An anchoring 422 gets ONE automatic
// degradation retry with every comment folded into the review body (quoted
// `file:line` + selectedText); nothing is silently dropped, and the response
// carries `commentsDegraded` for the receipt. An unknown-commit 422 fails
// CLOSED (409, "reload") — never a retry at a different SHA.
import { Hono, type Context } from "hono";
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
  audit,
  AuditAction,
  AuditActorType,
  decryptToken,
  forTenant,
  type InstallationId,
  type RepoId,
  type ValueOf,
} from "persistence";
import type { Result } from "types";
import { z } from "zod";
import { refreshSessionToken, type AuthRouteDeps } from "./auth";
import { createAuthzMiddleware, type AuthzEnv } from "./authz";

// ---------------------------------------------------------------------------
// Boundary schemas — shape only (the server needs no chunk knowledge; the FE
// already maps anchors to GitHub's wire shape). Length/count caps bound the
// payload; cross-field content rules are the ones GitHub would 422 anyway.
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

const MAX_COMMENTS = 100;
const MAX_BODY_LENGTH = 65_536;
const MAX_PATH_LENGTH = 1_024;
const MAX_SELECTED_TEXT_LENGTH = 4_000;

const shaSchema = z
  .string()
  .regex(/^[0-9a-f]{40}$/, "commitId must be a 40-hex SHA");
const sideSchema = z.union([
  z.literal(ReviewCommentSide.LEFT),
  z.literal(ReviewCommentSide.RIGHT),
]);

const commentSchema = z
  .object({
    path: z.string().min(1).max(MAX_PATH_LENGTH),
    line: z.number().int().positive(),
    side: sideSchema,
    startLine: z.number().int().positive().optional(),
    startSide: sideSchema.optional(),
    body: z.string().min(1).max(MAX_BODY_LENGTH),
    /** The anchored source text — only used for the degradation fold's quote. */
    selectedText: z.string().max(MAX_SELECTED_TEXT_LENGTH).optional(),
  })
  .refine(
    (comment) =>
      comment.startLine === undefined || comment.startLine < comment.line,
    { message: "startLine must be strictly before line" },
  );

const submitBodySchema = z
  .object({
    outcome: z.union([
      z.literal(ReviewOutcome.COMMENT),
      z.literal(ReviewOutcome.APPROVE),
      z.literal(ReviewOutcome.REQUEST_CHANGES),
    ]),
    commitId: shaSchema,
    body: z.string().max(MAX_BODY_LENGTH).optional(),
    comments: z.array(commentSchema).max(MAX_COMMENTS).default([]),
  })
  .refine(
    (submit) =>
      submit.outcome !== ReviewOutcome.COMMENT ||
      submit.comments.length > 0 ||
      (submit.body !== undefined && submit.body.trim() !== ""),
    {
      message: "a neutral comment review needs at least one comment or a body",
    },
  )
  .refine(
    // GitHub documents `body` as REQUIRED for the REQUEST_CHANGES event —
    // reject deterministically here instead of surfacing GitHub's unclassified
    // 422 as a retry-looking 502. (The FE always sends its signature line as
    // the body, so this only bites direct API callers.)
    (submit) =>
      submit.outcome !== ReviewOutcome.REQUEST_CHANGES ||
      (submit.body !== undefined && submit.body.trim() !== ""),
    { message: "a request-changes review needs a body" },
  )
  .refine(
    // Every accepted request must be representable by the degradation fold:
    // if the anchors 422, ALL comments move into the one review body, so the
    // folded rendering has to fit GitHub's body cap. Checked exactly (same
    // fold function) and up front — a deterministic 400 before any upstream
    // side effect, never a 502 halfway through a degraded retry.
    (submit) =>
      submit.comments.length === 0 ||
      foldCommentsIntoBody(submit.body, submit.comments).length <=
        MAX_BODY_LENGTH,
    { message: "comments are too large to fold into a single review body" },
  );

// Derived from `commentSchema` (not the outer schema) so the fold-budget
// refine can reference `foldCommentsIntoBody` without a circular inference.
type SubmitComment = z.infer<typeof commentSchema>;

const prNumberSchema = z.coerce.number().int().positive();

// ---------------------------------------------------------------------------
// Degradation fold: every comment becomes a quoted block in the review body.
// ---------------------------------------------------------------------------

function foldedCommentBlock(comment: SubmitComment): string {
  const range =
    comment.startLine === undefined
      ? String(comment.line)
      : `${comment.startLine}-${comment.line}`;
  const quote =
    comment.selectedText === undefined
      ? []
      : comment.selectedText.split("\n").map((line) => `> ${line}`);
  return [`**\`${comment.path}:${range}\`**`, ...quote, "", comment.body].join(
    "\n",
  );
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

/**
 * A sanitized error response carrying the gated-route `no-store` posture —
 * every handler response (success or failure) is per-viewer state.
 */
function errorJson(
  c: Context<AuthzEnv>,
  message: string,
  status: 400 | 401 | 404 | 409 | 502,
): Response {
  return c.json({ error: message }, status, { "cache-control": "no-store" });
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
 * Mount the submit route behind its own per-repo gate instance.
 * `evictConversation` is the conversation surface's cache hook (BRIEF-25):
 * a submitted review is a conversation write, so success drops the PR's
 * cached conversation.
 */
export function reviewSubmitRoute(
  deps: AuthRouteDeps,
  evictConversation: (
    installationId: InstallationId,
    repoId: RepoId,
    prNumber: number,
  ) => void,
): Hono<AuthzEnv> {
  const app = new Hono<AuthzEnv>();
  const authz = createAuthzMiddleware(deps);

  app.use("/api/repos/:repoId/pulls/:prNumber/review", authz);

  app.post("/api/repos/:repoId/pulls/:prNumber/review", async (c) => {
    let rawBody: unknown;
    try {
      rawBody = await c.req.json();
    } catch {
      return errorJson(c, "invalid request", 400);
    }
    const parsedBody = submitBodySchema.safeParse(rawBody);
    if (!parsedBody.success) {
      return errorJson(c, "invalid request", 400);
    }
    const submitBody = parsedBody.data;

    const ctx = c.get("ctx");
    const parsedPr = prNumberSchema.safeParse(c.req.param("prNumber"));
    if (!parsedPr.success) {
      return errorJson(c, "invalid request", 400);
    }
    const pr = await forTenant(deps.handle, ctx).pullRequests.getByNumber(
      c.get("repoId"),
      parsedPr.data,
    );
    if (pr === undefined) {
      return errorJson(c, "not found", 404);
    }

    // Viewer token: set by the gate on the verified path; on a positive-cache
    // hit decrypt lazily (same pattern as the diff proxy).
    let currentSession = c.get("session");
    const resolvedToken =
      c.get("accessToken") ?? (await resolveSessionToken(deps, currentSession));
    if (resolvedToken === undefined) {
      return errorJson(c, "unauthorized", 401);
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
        return errorJson(c, "unauthorized", 401);
      }
      // 403/404 both collapse to the gate's 404 posture: a viewer whose
      // access was revoked inside the positive-cache TTL must see exactly
      // what a cold gate denial shows — no existence leak, no distinguishable
      // status. Rate-limit/transport failures stay an honest 502.
      if (
        repoInfo.error.code === GitHubApiErrorCode.NOT_FOUND ||
        repoInfo.error.code === GitHubApiErrorCode.FORBIDDEN
      ) {
        return errorJson(c, "not found", 404);
      }
      return errorJson(c, "upstream error", 502);
    }
    const target = splitRepoSlug(repoInfo.value.fullName);
    if (target === undefined) {
      return errorJson(c, "not found", 404);
    }

    const baseInput: Omit<CreatePullRequestReviewInput, "body" | "comments"> = {
      owner: target.owner,
      repo: target.repo,
      prNumber: pr.prNumber,
      commitId: submitBody.commitId,
      event: OUTCOME_TO_EVENT[submitBody.outcome],
    };
    const anchoredInput: CreatePullRequestReviewInput = {
      ...baseInput,
      ...(submitBody.body === undefined ? {} : { body: submitBody.body }),
      ...(submitBody.comments.length === 0
        ? {}
        : { comments: toPrimitiveComments(submitBody.comments) }),
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
      submitBody.comments.length > 0
    ) {
      commentsDegraded = true;
      created = await createWithRefreshOnce({
        ...baseInput,
        body: foldCommentsIntoBody(submitBody.body, submitBody.comments),
      });
    }

    if (!created.ok) {
      return submitFailure(c, created.error);
    }

    // A submitted review is a conversation write — the cached conversation
    // is stale the moment it lands (BRIEF-25).
    evictConversation(ctx.installationId, c.get("repoId"), pr.prNumber);

    // Audit the successful post (D9: numeric-only; the checkpoint itself is
    // the webhook's to write when the echo arrives).
    await audit(deps.handle, {
      installationId: ctx.installationId,
      actorType: AuditActorType.REVIEWER,
      actorId: currentSession.reviewerId,
      action: AuditAction.SUBMIT,
      targetType: "pull_request",
      targetId: pr.id,
    });

    return c.json(
      { reviewId: Number(created.value.reviewId), commentsDegraded },
      201,
      { "cache-control": "no-store" },
    );
  });

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
    return errorJson(c, "pull request was rewritten since it was read", 409);
  }
  // A still-unauthorized final result (refresh budget spent or hard-failed)
  // is a clean re-login prompt, not an upstream error.
  if (error.code === GitHubApiErrorCode.UNAUTHORIZED) {
    return errorJson(c, "unauthorized", 401);
  }
  if (error.code === GitHubApiErrorCode.NOT_FOUND) {
    return errorJson(c, "not found", 404);
  }
  return errorJson(c, "upstream error", 502);
}
