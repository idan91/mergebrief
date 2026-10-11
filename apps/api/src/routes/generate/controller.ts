// Hono-free. URL validation and posture live in the handler; this op owns
// the viewer-token resolve (with the PAT backstop), the owner-scoped upsert,
// and the enqueue; the worker does the generation.
import type { PrLocator } from "brief-core/pr-url";
import {
  fetchPullRequest,
  GitHubApiErrorCodes,
  type GitHubApiError,
  type PullRequestInfo,
} from "github";
import { createIngestRoutines, type ReviewerId } from "persistence";
import type { Result } from "types/utils";
import { FailureKinds, isGitHubDenial } from "../../shared-errors/failures";
import { deriveLifecycle } from "../live-read/logic/lifecycle";
import type {
  GenerateControllerDeps,
  GenerateFailure,
  GenerateOutcome,
} from "./types";

// A paste is deliberate human intent, so it takes the App door's short
// intent window (ready_for_review), not its 60s push-storm window. A re-paste
// of a head that is already running is dropped by ingest; a re-paste of the
// same pending head only refreshes the payload.
const PASTE_DEBOUNCE_SECONDS = 10;

type GenerateBriefResult = Result<GenerateOutcome, GenerateFailure>;

interface GenerateBriefInput {
  readonly locator: PrLocator;
}

/**
 * The PAT backstop covers the one case a GitHub App user token structurally
 * cannot: a private repo with no App installation. Tried once, only after the
 * viewer is denied, and deliberately OUTSIDE `run`; a 401 from the operator's
 * key is not the viewer's expiry, and letting `run` see it would spend the
 * request's one refresh and then tell the reader to sign in again. On that
 * rejection the viewer's own denial stands, matching `runRead`.
 */
async function resolveUnderFallback(
  deps: GenerateControllerDeps,
  ref: { owner: string; repo: string; prNumber: number },
  viewer: Result<PullRequestInfo, GitHubApiError>,
): Promise<Result<PullRequestInfo, GitHubApiError>> {
  const fallbackToken = deps.fallbackToken;
  if (viewer.ok || fallbackToken === undefined) {
    return viewer;
  }
  if (!isGitHubDenial(viewer.error)) {
    return viewer;
  }
  const fallback = await fetchPullRequest(
    deps.github.createOctokit(fallbackToken),
    ref,
  );
  if (fallback.ok || fallback.error.code !== GitHubApiErrorCodes.UNAUTHORIZED) {
    return fallback;
  }
  deps.log.warn(
    "url-box fallback token rejected by GitHub — check the operator PAT",
  );
  return viewer;
}

export const generateController = {
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
      fetchPullRequest(deps.github.createOctokit(token), ref),
    );
    if (!viewer.ok && viewer.tokenUnreadable) {
      return { ok: false, error: { kind: FailureKinds.TOKEN_UNREADABLE } };
    }
    const resolved = await resolveUnderFallback(deps, ref, viewer);
    if (!resolved.ok) {
      if (resolved.error.code === GitHubApiErrorCodes.UNAUTHORIZED) {
        return { ok: false, error: { kind: "unauthorized" } };
      }
      if (isGitHubDenial(resolved.error)) {
        return { ok: false, error: { kind: "not-found" } };
      }
      return { ok: false, error: { kind: "github-unavailable" } };
    }
    const info = resolved.value;

    // The owner scope and the grant come from the SAME authenticated session
    // the binding the worker cannot verify is minted here, nowhere else.
    const principal = deps.github.session();
    const ownerUserId: ReviewerId = principal.reviewerId;
    // The paste is a live read: the row carries when GitHub answered and
    // the head it reported, so the Inbox needs no read of its own for it.
    const readAt = new Date();
    const prFields = {
      repoId: info.repoId,
      prNumber: input.locator.number,
      repoSlug: info.repoFullName,
      title: info.title,
      baseSha: info.baseSha,
      draft: info.draft,
      liveRead: { readAt, headSha: info.headSha },
    };
    const lifecycle = deriveLifecycle(info, readAt);
    const pullRequestInput =
      info.authorLogin === null
        ? { ...prFields, ...lifecycle }
        : { ...prFields, authorLogin: info.authorLogin, ...lifecycle };
    const outcome = await createIngestRoutines(deps.handle, {
      ownerUserId,
    }).triggerGeneration({
      pullRequest: pullRequestInput,
      headSha: info.headSha,
      debounceSeconds: PASTE_DEBOUNCE_SECONDS,
      grantId: principal.grantId,
    });
    if (!outcome.ok) {
      // The only expected failure is an invalid debounce; ours is constant.
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
