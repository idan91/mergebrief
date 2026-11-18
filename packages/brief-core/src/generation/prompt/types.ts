import type { Brief } from "../../types";
import type { RepoContext } from "../repo-context";

/**
 * The previous brief plus the mechanical frozen/re-look partition the worker
 * computed. The renderer trims it to ids, definitions, verbatim
 * summary/verdicts and ordering sequences: never code, which the diff carries.
 */
export interface AnchorViewInput {
  readonly previousBrief: Brief;
  readonly frozenGroupIds: readonly string[];
}

export interface BriefPromptOptions {
  readonly repoContext?: RepoContext | undefined;
  readonly anchored?: boolean;
  readonly holdsMedia?: boolean;
}

export interface ProductDiffPromptOptions {
  readonly anchored?: boolean;
}

export interface IntentCheckText {
  readonly fieldRule: string;
  readonly section: string;
  /** Closes the "Honest uncertainty" section of a call that writes the intent check. */
  readonly uncertaintyRule: string;
  readonly anchoredRule: string;
  readonly groupingAnchoredRule: string;
}

export interface ReadingOrderText {
  readonly fieldRule: string;
  readonly section: string;
  readonly anchoredRule: string;
  readonly groupingAnchoredRule: string;
}

export interface RiskSurfaceText {
  readonly section: string;
  /** The delta call's shorter take, worded for an incremental diff. */
  readonly deltaSection: string;
  readonly anchoredRule: string;
  readonly customAttributesSection: string;
}

export interface SummaryMediaText {
  readonly note: string;
}
