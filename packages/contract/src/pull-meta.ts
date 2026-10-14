// The PR meta: one pull request with its current span, generation and revisions.
import type { DraftPolicy, PrState } from "types";
import type { GenerationSummaryView } from "./generation";
import type { RevisionComparisons, RevisionView } from "./revisions";

export interface PullMetaView {
  /** Stringified: GitHub repo ids exceed JSON's safe-integer comfort zone. */
  readonly repoId: string;
  readonly repoSlug: string | null;
  readonly prNumber: number;
  readonly title: string | null;
  readonly state: PrState;
  /** The brief's base, else the ingest base; null on rows that predate it. */
  readonly baseSha: string | null;
  /** The current push's head; null only when nothing was ever projected. */
  readonly headSha: string | null;
  readonly briefAvailable: boolean;
  readonly draft: boolean;
  /** The PR author's GitHub login; null when GitHub sent no user. */
  readonly authorLogin: string | null;
  readonly viewerIsAuthor: boolean;
  /** Push or authorship: an affordance, GitHub enforces it at mutation. */
  readonly viewerCanResolve: boolean;
  readonly generation: GenerationSummaryView | null;
  readonly updatedAt: string;
  /** GitHub reports a head the latest brief does not cover. */
  readonly behind: boolean;
  readonly comparisons: RevisionComparisons;
  /** The PR sits in an installation's world; the App can act on its repo. */
  readonly appInstalled: boolean;
  /** The configured window a reader shows, never a hardcoded duration. */
  readonly draftPolicy: DraftPolicy;
  /** Every stored brief, ordered by `headIndex`; absent when none is stored. */
  readonly revisions?: readonly RevisionView[];
}
