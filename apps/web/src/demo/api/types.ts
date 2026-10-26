import type { ProductQueryIds } from "contract";

/** The reads scoped to one pull request: every path takes `repoId` and `prNumber`. */
export type PullReadId =
  | typeof ProductQueryIds.READ_PULL
  | typeof ProductQueryIds.READ_STACK
  | typeof ProductQueryIds.READ_CONVERSATION
  | typeof ProductQueryIds.READ_BRIEF_CONTEXT
  | typeof ProductQueryIds.READ_BRIEF
  | typeof ProductQueryIds.READ_DIFF
  | typeof ProductQueryIds.READ_MARKS
  | typeof ProductQueryIds.READ_NARRATIVE
  | typeof ProductQueryIds.READ_REVIEW_SESSION
  | typeof ProductQueryIds.READ_FILE_RANGE;

/** A diffs sidecar for one exact compare span, as GitHub's compare answers it. */
export interface DemoSpanDiff {
  readonly base: string;
  readonly head: string;
  readonly text: string;
}

/** One `GET` the demo answers: an exact path, with the query deciding the body. */
export interface DemoRead {
  readonly path: string;
  answer(query: URLSearchParams): Response;
}
