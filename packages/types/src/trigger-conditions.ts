import type { ValueOf } from "./utils";

/** A trigger condition's kind; the config, the stored unmet item and the wire all read it. */
export const TriggerConditionKinds = {
  READY_FOR_REVIEW: "ready-for-review",
  NEVER: "never",
  SIZE: "size",
  BOTS: "bots",
  REVIEW_REQUESTED: "review-requested",
  CI: "ci",
  PATHS: "paths",
  LABELS: "labels",
  TITLE_KEYWORDS: "title-keywords",
  BASE_BRANCHES: "base-branches",
} as const;
export type TriggerConditionKind = ValueOf<typeof TriggerConditionKinds>;

/** The review bots a `bots` condition may name. */
export const ReviewBots = {
  UNBLOCKED: "unblocked",
  CODERABBIT: "coderabbit",
  CLAUDE: "claude",
  GREPTILE: "greptile",
  COPILOT: "copilot",
} as const;
export type ReviewBot = ValueOf<typeof ReviewBots>;

/** Each review bot's product name, a proper noun every surface shows as is. */
export const ReviewBotNames = {
  [ReviewBots.UNBLOCKED]: "Unblocked",
  [ReviewBots.CODERABBIT]: "CodeRabbit",
  [ReviewBots.CLAUDE]: "Claude Code Review",
  [ReviewBots.GREPTILE]: "Greptile",
  [ReviewBots.COPILOT]: "Copilot",
} as const satisfies Record<ReviewBot, string>;

/** What a `bots` condition waits for from one bot on the current push. */
export const BotVerdicts = {
  FINISHED: "finished",
  APPROVED: "approved",
  CLEAN: "clean",
} as const;
export type BotVerdict = ValueOf<typeof BotVerdicts>;

/** Whose file set a condition: the repository's settings or the instance's config. */
export const TriggerConditionSetters = {
  REPO: "repo",
  INSTANCE: "instance",
} as const;
export type TriggerConditionSetter = ValueOf<typeof TriggerConditionSetters>;

/** An unmet item's kind: a condition kind, or `any` for a group of them. */
export const UnmetConditionKinds = {
  ...TriggerConditionKinds,
  ANY: "any",
} as const;
export type UnmetConditionKind = ValueOf<typeof UnmetConditionKinds>;

/** Where a `bots` condition's bot stands on the current push. */
export const BotStates = {
  NOT_STARTED: "not-started",
  RUNNING: "running",
  NOT_APPROVED: "not-approved",
  ISSUES: "issues",
  NO_VERDICT: "no-verdict",
  PERMISSION_MISSING: "permission-missing",
} as const;
export type BotState = ValueOf<typeof BotStates>;

/** What a `size` condition bounds. */
export const SizeMeasures = {
  CHANGED_LINES: "changed-lines",
  ADDITIONS: "additions",
  DELETIONS: "deletions",
} as const;
export type SizeMeasure = ValueOf<typeof SizeMeasures>;

/** Which `size` bound a count missed. */
export const SizeBoundSides = {
  MIN: "min",
  MAX: "max",
} as const;
export type SizeBoundSide = ValueOf<typeof SizeBoundSides>;

interface UnmetConditionBase {
  readonly setBy: TriggerConditionSetter;
}

export interface UnmetReadyForReview extends UnmetConditionBase {
  readonly kind: typeof TriggerConditionKinds.READY_FOR_REVIEW;
}
export interface UnmetNever extends UnmetConditionBase {
  readonly kind: typeof TriggerConditionKinds.NEVER;
}
export interface UnmetReviewRequested extends UnmetConditionBase {
  readonly kind: typeof TriggerConditionKinds.REVIEW_REQUESTED;
}
/** One missed bound; a `size` setting with two missed bounds stores two items. */
export interface UnmetSize extends UnmetConditionBase {
  readonly kind: typeof TriggerConditionKinds.SIZE;
  readonly measure: SizeMeasure;
  readonly side: SizeBoundSide;
  readonly limit: number;
  readonly actual: number;
}
export interface UnmetLabels extends UnmetConditionBase {
  readonly kind: typeof TriggerConditionKinds.LABELS;
  /** The configured labels; one of them is enough. */
  readonly labels: readonly string[];
}
export interface UnmetTitleKeywords extends UnmetConditionBase {
  readonly kind: typeof TriggerConditionKinds.TITLE_KEYWORDS;
  readonly keywords: readonly string[];
}
export interface UnmetBaseBranches extends UnmetConditionBase {
  readonly kind: typeof TriggerConditionKinds.BASE_BRANCHES;
  /** The branch the pull request targets. */
  readonly base: string;
  readonly branches: readonly string[];
}
export interface UnmetPaths extends UnmetConditionBase {
  readonly kind: typeof TriggerConditionKinds.PATHS;
  readonly paths: readonly string[];
}
/** One bot; a `bots` setting naming two unmet bots stores two items. */
export interface UnmetBot extends UnmetConditionBase {
  readonly kind: typeof TriggerConditionKinds.BOTS;
  readonly bot: ReviewBot;
  readonly verdict: BotVerdict;
  readonly state: BotState;
  /** Open findings, on `issues` only. */
  readonly issues?: number;
}
export interface UnmetCi extends UnmetConditionBase {
  readonly kind: typeof TriggerConditionKinds.CI;
  readonly failed: readonly string[];
  readonly running: readonly string[];
  readonly missing: readonly string[];
  /** The installation has not accepted the permissions the read needs. */
  readonly permissionMissing: boolean;
}

export type UnmetPlainCondition =
  | UnmetReadyForReview
  | UnmetNever
  | UnmetReviewRequested
  | UnmetSize
  | UnmetLabels
  | UnmetTitleKeywords
  | UnmetBaseBranches
  | UnmetPaths
  | UnmetBot
  | UnmetCi;

/** An `any` group none of whose members passed. */
export interface UnmetAnyGroup {
  readonly kind: typeof UnmetConditionKinds.ANY;
  readonly conditions: readonly UnmetPlainCondition[];
}

/** One stored unmet item on a held head, as the wire carries it. */
export type UnmetCondition = UnmetPlainCondition | UnmetAnyGroup;
