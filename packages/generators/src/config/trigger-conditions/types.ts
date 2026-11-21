import type {
  BotVerdict,
  ReviewBot,
  SizeMeasure,
  TriggerConditionKind,
  TriggerConditionKinds,
  TriggerConditionSetter,
} from "types";

/** Inclusive bounds; at least one is set. */
export interface SizeBounds {
  readonly min?: number;
  readonly max?: number;
}

export type SizeSetting = Readonly<Partial<Record<SizeMeasure, SizeBounds>>>;

export type BotsSetting = Readonly<Partial<Record<ReviewBot, BotVerdict>>>;

export const CiModes = {
  REQUIRED: "required",
  NAMED: "named",
} as const;

export interface CiRequiredSetting {
  readonly mode: typeof CiModes.REQUIRED;
}
export interface CiNamedSetting {
  readonly mode: typeof CiModes.NAMED;
  readonly checks: readonly string[];
}
export type CiSetting = CiRequiredSetting | CiNamedSetting;

/** What each kind's setting holds once parsed. */
export interface TriggerConditionValues {
  readonly [TriggerConditionKinds.READY_FOR_REVIEW]: true;
  readonly [TriggerConditionKinds.NEVER]: true;
  readonly [TriggerConditionKinds.SIZE]: SizeSetting;
  readonly [TriggerConditionKinds.BOTS]: BotsSetting;
  readonly [TriggerConditionKinds.REVIEW_REQUESTED]: true;
  readonly [TriggerConditionKinds.CI]: CiSetting;
  readonly [TriggerConditionKinds.PATHS]: readonly string[];
  readonly [TriggerConditionKinds.LABELS]: readonly string[];
  readonly [TriggerConditionKinds.TITLE_KEYWORDS]: readonly string[];
  readonly [TriggerConditionKinds.BASE_BRANCHES]: readonly string[];
}

/** One configured condition: its kind and the value that kind takes. */
export type TriggerConditionSetting = {
  readonly [Kind in TriggerConditionKind]: {
    readonly kind: Kind;
    readonly value: TriggerConditionValues[Kind];
  };
}[TriggerConditionKind];

export interface TriggerConditionsSwitchedOff {
  readonly off: true;
}

export interface TriggerConditionsList {
  readonly off: false;
  /** Every one must pass. */
  readonly all: readonly TriggerConditionSetting[];
  /** One passing is enough; never one kind alone in a file. */
  readonly any: readonly TriggerConditionSetting[];
  /** Kinds this file switches off, so an inherited one drops. */
  readonly dropped: readonly TriggerConditionKind[];
}

/** One file's `triggerConditions:` block, parsed. */
export type TriggerConditionsBlock =
  | TriggerConditionsSwitchedOff
  | TriggerConditionsList;

export interface EffectiveCondition {
  readonly setting: TriggerConditionSetting;
  readonly setBy: TriggerConditionSetter;
}

/** The conditions a push meets after the instance and repo blocks merge. */
export interface EffectiveTriggerConditions {
  readonly all: readonly EffectiveCondition[];
  readonly any: readonly EffectiveCondition[];
}
