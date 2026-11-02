import type { ComparisonMarks } from "brief-core";
import type {
  ArtifactStore,
  PullRequestRowId,
  SpanBaseRefs,
} from "persistence";
import { MarksStates, type MarksState } from "../types";

/** One span key: the natural key a marks row, a narrative and a delta share. */
export interface SpanKey {
  readonly pullRequestId: PullRequestRowId;
  readonly baselineSha: string;
  readonly headSha: string;
}

/**
 * Whether the key's marks row was written from `refs`. Marks never certify
 * a core computed from other bases, so a current row certifies that the
 * narrative and delta stored under the key were computed from the same span.
 */
export async function readMarksState(
  store: ArtifactStore,
  key: SpanKey,
  refs: SpanBaseRefs,
): Promise<MarksState> {
  const row = await store.comparisonMarks.get(
    key.pullRequestId,
    key.baselineSha,
    key.headSha,
  );
  if (row === undefined) {
    return MarksStates.ABSENT;
  }
  const isCurrent =
    row.prevBaseSha === refs.prevBase && row.newBaseSha === refs.newBase;
  return isCurrent ? MarksStates.CURRENT : MarksStates.STALE;
}

/**
 * Drops the key's marks row when it was written from other bases. Called
 * before anything under the key is rewritten, so a run stopped mid-rewrite
 * leaves the key unmarked, never marked from bases its text was not read on.
 */
export async function dropStaleMarks(
  store: ArtifactStore,
  key: SpanKey,
  refs: SpanBaseRefs,
): Promise<void> {
  const state = await readMarksState(store, key, refs);
  if (state === MarksStates.STALE) {
    await store.comparisonMarks.delete(
      key.pullRequestId,
      key.baselineSha,
      key.headSha,
    );
  }
}

/** The marks row, coordinates only: never the read-time label or index the strict schema refuses. */
export async function writeSpanMarks(
  store: ArtifactStore,
  pullRequestId: PullRequestRowId,
  marks: ComparisonMarks,
  refs: SpanBaseRefs,
): Promise<void> {
  await store.comparisonMarks.write({
    pullRequestId,
    marks: {
      baselineSha: marks.baselineSha,
      headSha: marks.headSha,
      files: marks.files,
    },
    refs,
  });
}
