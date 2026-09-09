// Hono-free artifact reads. A missing PR row or artifact is genuinely absent
// behind the gate, terminal and posture-free, so these ops THROW NotFound;
// stored bodies return verbatim (already JSON, never re-parsed).
import { createUserOctokit, fetchCompareDiff } from "github";
import type { GenerationProjection, RepoId, ReviewerId } from "persistence";
import type { DraftPolicy } from "types";
import { NotFound } from "../../../../shared-errors/api-error";
import { isGitHubDenial } from "../../../../shared-errors/failures";
import type { ReviewerGitHubClient } from "../../../auth/reviewer-github-client";
import { buildPrView } from "../../../pr-view";
import type { TtlCache } from "../../../ttl-cache";
import type { RevisionComparisons, RevisionView } from "contract";
import {
  comparisonSpanSet,
  makeLatestPendingProbe,
  narrativeSpanSet,
} from "./logic/revision-comparisons";
import { buildDiffCacheKey, composeBriefContextBody } from "./logic/keys";
import { buildRevisionView } from "./logic/revision-views";
import { DIFF_CACHE_MAX_ENTRY_BYTES, DIFF_CACHE_TTL_MS } from "./consts";
import type { DiffFailure, ReadsControllerDeps } from "./types";

interface SpanInput {
  readonly repoId: RepoId;
  readonly prNumber: number;
}

async function resolvePullRequestId(
  deps: ReadsControllerDeps,
  input: SpanInput,
) {
  const pr = await deps.tenant.pullRequests.getByNumber(
    input.repoId,
    input.prNumber,
  );
  if (pr === undefined) {
    throw new NotFound();
  }
  return pr.id;
}

type ReadDiffResult =
  | { readonly ok: true; readonly body: string }
  | { readonly ok: false; readonly error: DiffFailure };

export default {
  /** The whole-PR span artifact body for (base, head). */
  async readBrief(
    deps: ReadsControllerDeps,
    input: SpanInput & { readonly base: string; readonly head: string },
  ) {
    const pullRequestId = await resolvePullRequestId(deps, input);
    const row = await deps.artifacts.briefs.get(
      pullRequestId,
      input.base,
      input.head,
    );
    if (row === undefined) {
      throw new NotFound();
    }
    return row.body;
  },

  /** Comparison marks (coordinates only) for (baseline, head). */
  async readMarks(
    deps: ReadsControllerDeps,
    input: SpanInput & { readonly baseline: string; readonly head: string },
  ) {
    const pullRequestId = await resolvePullRequestId(deps, input);
    const row = await deps.artifacts.comparisonMarks.get(
      pullRequestId,
      input.baseline,
      input.head,
    );
    if (row === undefined) {
      throw new NotFound();
    }
    return row.body;
  },

  /** The pre-warmed reviewer-personal delta core for (baseline, head). */
  async readDelta(
    deps: ReadsControllerDeps,
    input: SpanInput & { readonly baseline: string; readonly head: string },
  ) {
    const pullRequestId = await resolvePullRequestId(deps, input);
    const row = await deps.artifacts.deltas.get(
      pullRequestId,
      input.baseline,
      input.head,
    );
    if (row === undefined) {
      throw new NotFound();
    }
    return row.body;
  },

  /** The revision narrative for (prevHead, head). */
  async readNarrative(
    deps: ReadsControllerDeps,
    input: SpanInput & { readonly prevHead: string; readonly head: string },
  ) {
    const pullRequestId = await resolvePullRequestId(deps, input);
    const row = await deps.artifacts.revisionNarratives.get(
      pullRequestId,
      input.prevHead,
      input.head,
    );
    if (row === undefined) {
      throw new NotFound();
    }
    return row.body;
  },

  /**
   * The brief's repo-config snapshot as a pre-composed JSON envelope, the
   * column already holds validated JSON, never re-parsed per request.
   * `repoConfig` is null for older rows.
   */
  async readBriefContext(
    deps: ReadsControllerDeps,
    input: SpanInput & { readonly base: string; readonly head: string },
  ) {
    const pullRequestId = await resolvePullRequestId(deps, input);
    const repoConfig = await deps.artifacts.briefs.getRepoConfig(
      pullRequestId,
      input.base,
      input.head,
    );
    if (repoConfig === undefined) {
      throw new NotFound();
    }
    return composeBriefContextBody(repoConfig);
  },

  /**
   * PR meta, the PR row + current-span derivation + latest brief-kind
   * generation summary, plus per-revision comparison availability derived
   * from ONE lean listing per artifact kind joined in memory.
   */
  async readPullMeta(
    deps: ReadsControllerDeps & {
      readonly generations: GenerationProjection;
    },
    input: SpanInput & {
      readonly repoFullName: string;
      readonly reviewerLogin: string | null;
      readonly reviewerId: ReviewerId;
      readonly viewerCanPush: boolean;
      readonly draftPolicy: DraftPolicy;
    },
  ) {
    const pr = await deps.tenant.pullRequests.getByNumber(
      input.repoId,
      input.prNumber,
    );
    if (pr === undefined) {
      throw new NotFound();
    }
    const ids = [pr.id];
    const [latestBriefs, latestGenerations] = await Promise.all([
      deps.artifacts.briefs.latestForPullRequests(ids),
      deps.generations.latestBriefForPullRequests(ids),
    ]);
    const view = buildPrView(
      pr,
      latestBriefs.get(pr.id),
      latestGenerations.get(pr.id),
      input.repoFullName,
      // The viewer's verified login from the session; `viewerIsAuthor` is
      // derived per request, never cached.
      input.reviewerLogin,
      // Push capability from the gate's access check, ≤60s stale via the
      // positive cache, same budget as `repoFullName`.
      input.viewerCanPush,
    );
    // INVARIANT: `briefAvailable` implies `headSha !== null` (`brief.head_sha`
    // is NOT NULL), so the null check below is TypeScript narrowing only and
    // can never skip stored revisions.
    let comparisons: RevisionComparisons = {};
    let revisions: RevisionView[] | undefined;
    if (view.briefAvailable && view.headSha !== null) {
      const headSha = view.headSha;
      const pullRequestId = pr.id;
      const [
        briefs,
        markRows,
        deltaRows,
        narrativeRows,
        checkpoint,
        briefGenerations,
      ] = await Promise.all([
        deps.artifacts.briefs.listForPullRequest(pullRequestId),
        deps.artifacts.comparisonMarks.listForPullRequest(pullRequestId),
        deps.artifacts.deltas.listForPullRequest(pullRequestId),
        deps.artifacts.revisionNarratives.listForPullRequest(pullRequestId),
        deps.tenant.checkpoints.get(pullRequestId, input.reviewerId),
        deps.generations.listBriefsForPullRequest(pullRequestId),
      ]);
      // `created_at` is the first enqueue for that head, the earliest bound
      // of what the brief's acquisition could have seen. One row per head,
      // shared by duplicate-head (retarget) revisions.
      const generatedAtByHead = new Map(
        briefGenerations.map((row) => [row.headSha, row.createdAt]),
      );
      const markSpans = comparisonSpanSet(markRows);
      const deltaSpans = comparisonSpanSet(deltaRows);
      const narrativeSpans = narrativeSpanSet(narrativeRows);
      // The generation-pending refinement (a DB probe) is wired for the
      // CURRENT head SHA only: history is never actively warming. Gated by
      // headSha, not row identity, because lastReview is a pure function of
      // (checkpoint, headSha), so duplicate rows sharing the current head must
      // report identical state. The probe memoizes per baseline.
      const latestPendingProbe = makeLatestPendingProbe(
        deps.generations,
        pullRequestId,
        headSha,
        latestGenerations.get(pullRequestId),
      );
      revisions = await Promise.all(
        briefs.map((entry) =>
          buildRevisionView(entry, {
            briefs,
            markSpans,
            deltaSpans,
            narrativeSpans,
            checkpoint,
            generatedAtByHead,
            currentHeadSha: headSha,
            latestPendingProbe,
          }),
        ),
      );
      comparisons = revisions.at(-1)?.comparisons ?? {};
    }
    // draftPolicy is meta-only (instance-wide, so the list would repeat it
    // per row for nothing). The FE must show the CONFIGURED window, never a
    // hardcoded duration.
    if (revisions === undefined) {
      return { ...view, comparisons, draftPolicy: input.draftPolicy };
    }
    return { ...view, comparisons, revisions, draftPolicy: input.draftPolicy };
  },

  /**
   * The LIVE diff proxy for the requested `base...head` span, the viewer's
   * token, cached per session (~60s), NEVER persisted. Serve always; cache
   * only when small enough (oversized diffs are rare and cheap to re-proxy).
   */
  async readDiff(
    deps: ReadsControllerDeps & {
      readonly github: ReviewerGitHubClient;
      readonly diffCache: TtlCache<string>;
    },
    input: SpanInput & {
      readonly owner: string;
      readonly repo: string;
      readonly base: string;
      readonly head: string;
      readonly sessionTokenHash: string;
    },
  ) {
    const pr = await deps.tenant.pullRequests.getByNumber(
      input.repoId,
      input.prNumber,
    );
    if (pr === undefined) {
      throw new NotFound();
    }
    const cacheKey = buildDiffCacheKey({
      sessionTokenHash: input.sessionTokenHash,
      repoId: input.repoId,
      prNumber: pr.prNumber,
      base: input.base,
      head: input.head,
    });
    const now = Date.now();
    const cached = deps.diffCache.get(cacheKey, now);
    if (cached !== undefined) {
      return { ok: true, body: cached } satisfies ReadDiffResult;
    }

    // Fetch the diff for the REQUESTED span (base...head), not the whole PR.
    const span = {
      owner: input.owner,
      repo: input.repo,
      base: input.base,
      head: input.head,
    };
    let attempts = 0;
    const diff = await deps.github.runRead((token) => {
      attempts += 1;
      return fetchCompareDiff(createUserOctokit(token), span);
    }, isGitHubDenial);
    if (!diff.ok) {
      if ("kind" in diff.error) {
        return {
          ok: false,
          error: { kind: "token-unreadable" },
        } satisfies ReadDiffResult;
      }
      return {
        ok: false,
        error: {
          kind: "github-denied",
          error: diff.error,
          retried: attempts > 1,
        },
      } satisfies ReadDiffResult;
    }
    if (diff.value.length <= DIFF_CACHE_MAX_ENTRY_BYTES) {
      deps.diffCache.set(cacheKey, diff.value, now + DIFF_CACHE_TTL_MS, now);
    }
    return { ok: true, body: diff.value } satisfies ReadDiffResult;
  },
};
