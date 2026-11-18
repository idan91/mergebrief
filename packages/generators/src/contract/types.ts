import type { ValueOf } from "types/utils";

export const GeneratorWarningKinds = {
  SALVAGED: "salvaged",
  FEEDBACK_RETRY: "feedback-retry",
  SERVED_MODEL_UNVERIFIED: "served-model-unverified",
  SERVED_MODEL_MISMATCH: "served-model-mismatch",
  EFFORT_REJECTED: "effort-rejected",
  USAGE_REJECTED: "usage-rejected",
  PLAN_MODE_UNVERIFIED: "plan-mode-unverified",
} as const;
export type GeneratorWarningKind = ValueOf<typeof GeneratorWarningKinds>;

/**
 * A degradation one generation survived. `message` is the operator log line
 * minus anything local to this host: never a dump path, a key or a URL.
 */
export interface GeneratorWarning {
  kind: GeneratorWarningKind;
  message: string;
}

export type GeneratorWarningSink = (warning: GeneratorWarning) => void;
