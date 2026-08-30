// Hono-free. URL validation and posture live in the handler; this op owns
// the viewer-token resolve (with the PAT backstop), the owner-scoped upsert,
// and the enqueue — the worker does the generation.
import type { PrLocator } from "brief-core";
import {
  createUserOctokit,
  fetchPullRequest,
  GitHubApiErrorCode,
  type GitHubApiError,
  type PullRequestInfo,
} from "github";
import {
  createIngestRoutines,
  PrStates,
  type PullRequestLifecycle,
  type ReviewerId,
} from "persistence";
import type { Result } from "types";
import { isGitHubDenial } from "../../shared-errors/failures";
import type { ReviewerTokenFailure } from "../auth/reviewer-github-client";
import type {
  GenerateControllerDeps,
  GenerateFailure,
  GenerateOutcome,
} from "./types";

// A paste is deliberate human intent, so it takes the App door's short
// intent window (ready_for_review), not its 60s push-storm window. Zero is
// wrong: job_key replaces a PENDING job only, so a re-paste that lands after
// the worker claimed the first one buys a second full generation.
const PASTE_DEBOUNCE_SECONDS = 10;

type GenerateBriefResult = Result<GenerateOutcome, GenerateFailure>;

interface GenerateBriefInput {
  readonly locator: PrLocator;
}

/**
 * The PR lifecycle as the live GitHub read reports it. Unlike the webhook
 * door, terminal states are first-class here — briefing a merged PR is the
 * url-box's primary use.
 */
function buildLifecycle(info: PullRequestInfo): PullRequestLifecycle {
  if (info.merged) {
    return {
      state: PrStates.MERGED,
      closedAt: info.closedAt ?? new Date(),
      purgeAfter: null,
    };
  }
  if (info.state === "closed") {
    return {
      state: PrStates.CLOSED,
      closedAt: info.closedAt ?? new Date(),
      purgeAfter: null,
    };
  }
  return { state: PrStates.OPEN };
}

/**
 * The PAT backstop covers the one case a GitHub App user token structurally
 * cannot: a private repo with no App installation. Tried once, only after the
 * viewer is denied, and deliberately OUTSIDE `run` — a 401 from the operator's
 * key is not the viewer's expiry, and letting `run` see it would spend the
 * request's one refresh and then tell the reader to sign in again. On that
 * rejection the viewer's own denial stands, matching `runRead`.
 */
async function resolveUnderFallback(
  deps: GenerateControllerDeps,
  ref: { owner: string; repo: string; prNumber: number },
  viewer: Result<PullRequestInfo, GitHubApiError | ReviewerTokenFailure>,
): Promise<Result<PullRequestInfo, GitHubApiError | ReviewerTokenFailure>> {
  const fallbackToken = deps.fallbackToken;
  if (viewer.ok || fallbackToken === undefined) {
    return viewer;
  }
  if ("kind" in viewer.error || !isGitHubDenial(viewer.error)) {
    return viewer;
  }
  const fallback = await fetchPullRequest(
    createUserOctokit(fallbackToken),
    ref,
  );
  if (fallback.ok || fallback.error.code !== GitHubApiErrorCode.UNAUTHORIZED) {
    return fallback;
  }
  deps.log.warn(
    "url-box fallback token rejected by GitHub — check the operator PAT",
  );
  return viewer;
}

export default {
  async generateBrief(
    deps: GenerateControllerDeps,
    input: GenerateBriefInput,
  ): Promise<GenerateBriefResult> {
    const ref = {
      owner: input.locator.owner,
      repo: input.locator.repo,
      prNumber: input.locator.number,
    };
    // The viewer-token read IS the access check.
    const viewer = await deps.github.run(async (token) =>
      fetchPullRequest(createUserOctokit(token), ref),
    );
    const resolved = await resolveUnderFallback(deps, ref, viewer);
    if (!resolved.ok) {
      if ("kind" in resolved.error) {
        return { ok: false, error: { kind: "token-unreadable" } };
      }
      if (resolved.error.code === GitHubApiErrorCode.UNAUTHORIZED) {
        return { ok: false, error: { kind: "unauthorized" } };
      }
      if (isGitHubDenial(resolved.error)) {
        return { ok: false, error: { kind: "not-found" } };
      }
      return { ok: false, error: { kind: "github-unavailable" } };
    }
    const info = resolved.value;

    // The owner scope and the grant come from the SAME authenticated session
    // — the binding the worker cannot verify is minted here, nowhere else.
    const principal = deps.github.session();
    const ownerUserId: ReviewerId = principal.reviewerId;
    const prFields = {
      repoId: info.repoId,
      prNumber: input.locator.number,
      repoSlug: info.repoFullName,
      title: info.title,
      baseSha: info.baseSha,
      draft: info.draft,
    };
    const pullRequestInput =
      info.authorLogin === null
        ? { ...prFields, ...buildLifecycle(info) }
        : {
            ...prFields,
            authorLogin: info.authorLogin,
            ...buildLifecycle(info),
          };
    const outcome = await createIngestRoutines(deps.handle, {
      ownerUserId,
    }).triggerGeneration({
      pullRequest: pullRequestInput,
      headSha: info.headSha,
      debounceSeconds: PASTE_DEBOUNCE_SECONDS,
      grantId: principal.grantId,
    });
    if (!outcome.ok) {
      // The only expected failure is an invalid debounce — ours is constant.
      throw new Error(outcome.error.message);
    }
    return {
      ok: true,
      value: {
        repoId: String(outcome.value.pullRequest.repoId),
        prNumber: outcome.value.pullRequest.prNumber,
        pullRequestId: outcome.value.pullRequest.id,
      },
    };
  },
};
