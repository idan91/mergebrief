import type {
  ConversationResponse,
  DiffMode,
  ProductQueryIds,
  PullMetaView,
} from "contract";

/** The reads scoped to one pull request: every path takes `repoId` and `prNumber`. */
export type PullReadId =
  | typeof ProductQueryIds.READ_PULL
  | typeof ProductQueryIds.READ_STACK
  | typeof ProductQueryIds.READ_CONVERSATION
  | typeof ProductQueryIds.READ_BRIEF_CONTEXT
  | typeof ProductQueryIds.READ_BRIEF
  | typeof ProductQueryIds.READ_BRIEF_LAYOUT
  | typeof ProductQueryIds.READ_DIFF
  | typeof ProductQueryIds.READ_MARKS
  | typeof ProductQueryIds.READ_NARRATIVE
  | typeof ProductQueryIds.READ_FILE_RANGE;

/** A diffs sidecar for one exact span, and the read the api serves it as. */
export interface DemoSpanDiff {
  readonly base: string;
  readonly head: string;
  readonly mode: DiffMode;
  readonly text: string;
}

/** One `GET` the demo answers: an exact path, with the query deciding the body. */
export interface DemoRead {
  readonly path: string;
  answer(query: URLSearchParams): Response;
}

/** A pull request the demo answers for: its meta and its conversation. */
export interface DemoPull {
  readonly prNumber: number;
  readonly meta: PullMetaView;
  readonly conversation: ConversationResponse;
}
