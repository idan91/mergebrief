import { isSpanTooLargeSkipRecord } from "brief-core/artifact";
import { createArtifactStore, type AppDatabase } from "persistence";
import type { Mutable } from "types/utils";
import type { PullRequestAccess } from "../../../../../access/types";
import {
  SpanReadKinds,
  type SpanKeyFacts,
  type SpanKeyReader,
  type SpanPair,
  type SpanRead,
} from "../types";
import { classifySpanKey, isWholePullRequestPair } from "./span-mode";

/** The pair's marks refs and whether the worker stored the span as too large to read. */
async function readSpanKeyFacts(
  handle: AppDatabase,
  access: PullRequestAccess,
  pair: SpanPair,
): Promise<SpanKeyFacts> {
  const store = createArtifactStore(handle, access.rowScope);
  const pullRequestId = access.row.id;
  const [marks, narrative, delta] = await Promise.all([
    store.comparisonMarks.get(pullRequestId, pair.base, pair.head),
    store.revisionNarratives.get(pullRequestId, pair.base, pair.head),
    store.deltas.get(pullRequestId, pair.base, pair.head),
  ]);
  const skipBodies = [narrative?.body, delta?.body];
  const isRefused = skipBodies.some(
    (body) => body !== undefined && isSpanTooLargeSkipRecord(body),
  );

  const facts: Mutable<SpanKeyFacts> = { isRefused };
  if (marks !== undefined) {
    facts.marksRefs = {
      prevBase: marks.prevBaseSha,
      newBase: marks.newBaseSha,
    };
  }
  return facts;
}

/**
 * Classifies a pair from the PR's stored rows: whole-PR pairs compare with
 * no span read, any other pair by its span key. A database error rejects,
 * so the request fails rather than falling back to a compare.
 */
export function createSpanKeyReader(handle: AppDatabase): SpanKeyReader {
  return {
    async classify(access, pair): Promise<SpanRead> {
      const { briefs } = createArtifactStore(handle, access.rowScope);
      const briefRows = await briefs.listForPullRequest(access.row.id);
      const briefPairs = briefRows.map((row) => ({
        base: row.baseSha,
        head: row.headSha,
      }));
      const currentBase = access.row.baseSha ?? undefined;
      if (isWholePullRequestPair(pair, briefPairs, currentBase)) {
        return { kind: SpanReadKinds.COMPARE };
      }

      const facts = await readSpanKeyFacts(handle, access, pair);
      return classifySpanKey(pair, facts);
    },
  };
}
