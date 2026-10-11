import type { RefObject } from "react";
import type { ValueOf } from "types/utils";

import type { Concern } from "brief-core/types";

export const SplitSegmentKinds = {
  CONCERN: "concern",
  UNATTRIBUTED_REMAINDER: "unattributed-remainder",
} as const;
export type SplitSegmentKind = ValueOf<typeof SplitSegmentKinds>;

interface SplitShareBase {
  added: number;
  deleted: number;
  /** Apportioned share of the whole-diff changed-line total, 0 to 100. */
  percent: number;
}

export interface AttributedConcernShare extends SplitShareBase {
  kind: typeof SplitSegmentKinds.CONCERN;
  concern: Concern;
}

export interface UnattributedRemainderShare extends SplitShareBase {
  kind: typeof SplitSegmentKinds.UNATTRIBUTED_REMAINDER;
}

export type ConcernShare = AttributedConcernShare | UnattributedRemainderShare;

export interface CardMinHeightInput {
  summaryHeight: number;
  rowGap: number;
  /** The bar stack's height when every bar was last closed; undefined before. */
  collapsedStackHeight: number | undefined;
}

export interface HeldCardHeightRefs {
  gridRef: RefObject<HTMLDivElement | null>;
  summaryRef: RefObject<HTMLDivElement | null>;
  stackRef: RefObject<HTMLDivElement | null>;
}

/** A Split segment as the page names it: a concern, or the Unattributed remainder. */
export interface ConcernSegment {
  key: string;
  /** Absent for the remainder, which takes the neutral mark. */
  concern?: Concern;
  name: string;
  share: ConcernShare;
}
