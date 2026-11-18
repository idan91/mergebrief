import type { ValueOf } from "types/utils";

export const FailureBlockScales = {
  PAGE: "page",
  REGION: "region",
} as const;

export type FailureBlockScale = ValueOf<typeof FailureBlockScales>;
