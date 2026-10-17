import type { PrLocator } from "brief-core/pr-url";
import {
  GitHubApiErrorCodes,
  type GitHubCall,
  type PullRequestInfo,
  type ReviewerGitHub,
} from "github";
import { createIngestRoutines } from "persistence";
import type { Result } from "types/utils";
import type { RequestGitHub } from "../../access/reviewer-binding";
import { FailureKinds, isGitHubDenial } from "../../shared-errors/failures";
import { deriveLifecycle } from "../live-read/logic/lifecycle";
import type {
  GenerateBriefDeps,
  GenerateFailure,
  GenerateOutcome,
} from "./types";

// A paste is deliberate human intent, so it takes the App door's short
// intent window (ready_for_review), not its 60s push-storm window. A re-paste
// of a head that is already running is dropped by ingest; a re-paste of the
// same pending head only refreshes the payload.
const PASTE_DEBOUNCE_SECONDS = 10;

/**
 * The viewer's read is the access check. The operator answers only a denied
 * one, and outside the binding: a 401 from the operator's key is not the
 * viewer's expiry, so it spends no renewal and the viewer's own denial
 * stands.
 */
async function readPastedPullRequest(
  deps: GenerateBriefDeps,
  github: ReviewerGitHub,
  locator: PrLocator,
): GitHubCall<PullRequestInfo> {
  const repo = { owner: locator.owner, repo: locator.repo };
  const viewer = await github.forRepo(repo).fetchPullRequest(locator.number);
  if (viewer.ok || deps.operator === undefined) {
    return viewer;
  }
  if (!isGitHubDenial(viewer.error)) {
    return viewer;
  }

  const operator = deps.operator.forRepo(repo);
  const fallback = await operator.fetchPullRequest(locator.number);
  if (fallback.ok || fallback.error.code !== GitHubApiErrorCodes.UNAUTHORIZED) {
    return fallback;
  }
  deps.log.warn(
    "url-box fallback token rejected by GitHub, check the operator PAT",
  );
  return viewer;
}

/**
 * Resolve the pasted pull request, upsert it into the reader's own owner
 * world, and enqueue the worker job. The owner scope and the grant come from
 * the request's own credential: the binding the worker cannot verify is
 * minted here, nowhere else.
 */
export async function generateBrief(
  deps: GenerateBriefDeps,
  request: RequestGitHub,
  locator: PrLocator,
): Promise<Result<GenerateOutcome, GenerateFailure>> {
  const resolved = await readPastedPullRequest(deps, request.github, locator);
  if (!resolved.ok) {
    const error = resolved.error;
    return {
      ok: false,
      error: { kind: FailureKinds.GITHUB_DENIED, phase: "resolve", error },
    };
  }
  const info = resolved.value;

  const principal = request.credential.session();
  // The paste is a live read: the row carries when GitHub answered and
  // the head it reported, so the Inbox needs no read of its own for it.
  const readAt = new Date();
  const prFields = {
    repoId: info.repoId,
    prNumber: locator.number,
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
  const { pullRequest } = await createIngestRoutines(deps.handle, {
    ownerUserId: principal.reviewerId,
  }).triggerGeneration({
    pullRequest: pullRequestInput,
    headSha: info.headSha,
    debounceSeconds: PASTE_DEBOUNCE_SECONDS,
    grantId: principal.grantId,
  });

  return {
    ok: true,
    value: {
      repoId: String(pullRequest.repoId),
      prNumber: pullRequest.prNumber,
      pullRequestId: pullRequest.id,
    },
  };
}
