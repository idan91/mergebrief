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

/** What a `bots` condition waits for from one bot on the current push. */
export const BotVerdicts = {
  FINISHED: "finished",
  APPROVED: "approved",
  CLEAN: "clean",
} as const;
export type BotVerdict = ValueOf<typeof BotVerdicts>;

/** Whose file set a condition: the repository's settings or the instance's config. */
export const TriggerConditionSources = {
  REPO: "repo",
  INSTANCE: "instance",
} as const;
export type TriggerConditionSource = ValueOf<typeof TriggerConditionSources>;

/** What a `size` condition bounds. */
export const SizeMeasures = {
  CHANGED_LINES: "changed-lines",
  ADDITIONS: "additions",
  DELETIONS: "deletions",
} as const;
export type SizeMeasure = ValueOf<typeof SizeMeasures>;
