// Hono-free artifact reads. A missing PR row or artifact is genuinely absent
// behind the gate — terminal and posture-free — so these ops THROW NotFound;
// stored bodies return verbatim (already JSON, never re-parsed).
import type { RepoId } from "persistence";
import { ApiErrorCode } from "../../../../error-response";
import { NotFound } from "../../../../shared-errors/api-error";
import type { ReadsControllerDeps } from "./types";

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
    throw new NotFound(ApiErrorCode.NOT_FOUND);
  }
  return pr.id;
}

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
      throw new NotFound(ApiErrorCode.NOT_FOUND);
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
      throw new NotFound(ApiErrorCode.NOT_FOUND);
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
      throw new NotFound(ApiErrorCode.NOT_FOUND);
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
      throw new NotFound(ApiErrorCode.NOT_FOUND);
    }
    return row.body;
  },
};
