import type { TranslationKey } from "i18n";
import type { ValueOf } from "types/utils";

import type { PrSummary } from "../../../../../types";

/** What the new brief is doing, first match winning in this order. */
export const NewerCommitsStates = {
  NEW_BRIEF: "new-brief",
  GENERATING: "generating",
  STALLED: "stalled",
  ON_DEMAND: "on-demand",
  FAILED: "failed",
  EXHAUSTED: "exhausted",
  SKIPPED: "skipped",
  NO_BRIEF: "no-brief",
} as const;
export type NewerCommitsState = ValueOf<typeof NewerCommitsStates>;

export const NewerCommitsActionKinds = {
  NAVIGATE: "navigate",
  GENERATE: "generate",
  RETRY: "retry",
} as const;
export type NewerCommitsActionKind = ValueOf<typeof NewerCommitsActionKinds>;

/** The actions that start a run, as opposed to moving to a stored brief. */
export type RunActionKind = Exclude<
  NewerCommitsActionKind,
  typeof NewerCommitsActionKinds.NAVIGATE
>;

/** A run action's text at rest and while its request is in flight. */
export interface RunActionLabelKeys {
  readonly rest: TranslationKey;
  readonly pending: TranslationKey;
}

/** The one thing the viewer can do about the new brief. */
export interface NewerCommitsAction {
  readonly kind: NewerCommitsActionKind;
  /** Already switched for the pending state. */
  readonly label: string;
  readonly pending: boolean;
  readonly onTrigger: () => void;
}

/** One chip's worth of state: its segments, the popover's words, the action. */
export interface NewerCommitsStatus {
  readonly state: NewerCommitsState;
  /** "Newer commits", or "New base" where only the base moved. */
  readonly label: string;
  /** The info button's accessible name. */
  readonly infoLabel: string;
  /** The status segment; absent where the action says it all. */
  readonly statusLabel?: string;
  /** The popover's heading. */
  readonly title: string;
  /** The popover's sentences, lead first. */
  readonly explanation: readonly string[];
  /** The last paste refusal, until the next paste. */
  readonly failure?: string;
  readonly action?: NewerCommitsAction;
  /** The latest push's run, offered in the popover while the chip's action moves to a newer stored brief. */
  readonly runAction?: NewerCommitsAction;
}

/** A run the chip can start, and whether its request is in flight. */
export interface NewerCommitsRun {
  readonly pending: boolean;
  readonly trigger: () => void;
}

/** The url row's paste-path run: offered only where the pull request's URL is known. */
export interface PasteRun {
  readonly pending: boolean;
  /** The last refusal's curated line; absent until one. */
  readonly failure?: string;
  readonly trigger?: () => void;
}

export interface NewerCommitsInput {
  readonly meta: PrSummary;
  /** The brief on screen is for a head older than the PR's latest push. */
  readonly staleHead: boolean;
  /** Present only when a newer briefed revision exists to move to. */
  readonly onGoToNewest?: (() => void) | undefined;
  /** The regenerate route's run for the latest push (Retry, Generate). */
  readonly latestRun: NewerCommitsRun;
  readonly pasteRun: PasteRun;
}

/** The chip's state and the one live region that outlives it. */
export interface NewerCommitsChipState {
  readonly announcement: string;
  readonly status?: NewerCommitsStatus;
}
