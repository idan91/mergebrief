import type { GenerationUnitsParams, UnmetCondition, ValueOf } from "types";

/** Which body an Entry comment holds, written into its hidden kind token. */
export const EntryBodyKinds = {
  GENERATING: "generating",
  READY: "ready",
  FAILED: "failed",
  CAPPED: "capped",
  CLOSED: "closed",
  ON_DEMAND: "on-demand",
  HELD: "held",
} as const;
export type EntryBodyKind = ValueOf<typeof EntryBodyKinds>;

/** What a body's kind token says: its kind and, for a body about one head, that head. */
export interface EntryBodyToken {
  readonly kind: EntryBodyKind;
  readonly headSha: string | undefined;
}

/** Where a body about the PR as a whole points: the PR view, no span. */
export interface EntryCommentPrViewLink {
  readonly publicBaseUrl: string;
  readonly repoId: bigint;
  readonly prNumber: number;
}

/** Where a body about the PR's next brief points: the rev it takes, no head named. */
export interface EntryCommentRevisionLink extends EntryCommentPrViewLink {
  /** The brief's index on this PR, the `rev` the web route addresses. */
  readonly headIndex: number;
}

/** Where a body about one head points: its revision, the head named in the body. */
export interface EntryCommentLink extends EntryCommentRevisionLink {
  /** Named in the body's short sha, never in the link. */
  readonly headSha: string;
}

/** Where the capped body points: the PR view, with no brief to deep-link. */
export interface EntryCommentCappedLink extends EntryCommentPrViewLink {
  /** The head that got no brief, named so the thread knows which push. */
  readonly headSha: string;
  /** When generation resumes, as an ISO instant (the next UTC midnight). */
  readonly resetsAt: Date;
  /** A large run's refusal: the heading names the runs it needed and the day's rest. */
  readonly units?: GenerationUnitsParams | undefined;
}

/** What a multi-call run's generating body says once its grouping call planned the parts. */
export interface EntryCommentLargeRun {
  readonly parts: number;
  /** Rounded already; the body shows it as approximate. */
  readonly estimateMinutes: number;
}

/** Where the held body points: Generate on the head's rev, and the newest brief. */
export interface EntryCommentHeldLinks {
  /** The rev the held head's brief takes, where the web offers Generate. */
  readonly next: EntryCommentLink;
  /** The PR's newest brief, linked so a reader still has one. */
  readonly previous: EntryCommentLink | undefined;
}

/** What the held body says: the head's unmet conditions and where to go from it. */
export interface EntryCommentHeld extends EntryCommentHeldLinks {
  readonly unmet: readonly UnmetCondition[];
  /** The stored list held items this worker could not read, a newer release's kinds. */
  readonly unmetConditionsPartial?: boolean;
}
