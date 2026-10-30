import type { ValueOf } from "types/utils";

import type { BriefSearchParams } from "../../../../model/comparison/compare-state";
import type { PrStack, PrStackMember } from "../../../../model/types";

export const StackChipOpeners = {
  HOVER: "hover",
  CLICK: "click",
} as const;

export type StackChipOpener = ValueOf<typeof StackChipOpeners>;

export interface StackView {
  stack: PrStack;
  /** The generation-time stack, present only when it differs from `stack`. */
  snapshot?: PrStack;
  /** ISO time `stack` was recorded, when it is the record rather than live. */
  asOf?: string;
  /** `stack` is the generation-time one, standing in for a closed PR. */
  atGeneration?: true;
}

/** Where a stack member's link goes: the app route, GitHub, or nowhere. */
export const NeighbourTargetKinds = {
  ROUTE: "route",
  GITHUB: "github",
  NONE: "none",
} as const;

export interface NeighbourRouteParams {
  repoId: string;
  prNumber: string;
}

export type NeighbourTarget =
  | {
      kind: typeof NeighbourTargetKinds.ROUTE;
      params: NeighbourRouteParams;
      search: BriefSearchParams;
    }
  | { kind: typeof NeighbourTargetKinds.GITHUB; href: string }
  | { kind: typeof NeighbourTargetKinds.NONE };

/** One line of the stack list, in display order. */
export interface StackRow {
  member: PrStackMember;
  /** 1-based place in the chain, counted from its base; a fork's rows have none. */
  position?: number;
  current: boolean;
}

/** The PRs either side of this one in a linear stack; absent at an end. */
export interface StackNeighbours {
  previous?: PrStackMember;
  next?: PrStackMember;
}

export const StackDirections = {
  PREVIOUS: "previous",
  NEXT: "next",
} as const;

export type StackDirection = ValueOf<typeof StackDirections>;

/** One arrow's accessible name and where it goes. */
export interface StackArrowView {
  label: string;
  target: NeighbourTarget;
  /** Nowhere to go: an end of the stack, or a URL that cannot be rewritten. */
  disabled: boolean;
}
