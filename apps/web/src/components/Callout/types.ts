import type { PointerEvent } from "react";
import type { ValueOf } from "types/utils";

/** The card surface, or the darker ground with a stronger edge for a list panel. */
export const CalloutSurfaces = {
  RAISED: "raised",
  GROUND: "ground",
} as const;

export type CalloutSurface = ValueOf<typeof CalloutSurfaces>;

export interface CalloutHover {
  readonly open: boolean;
  readonly arm: (event: PointerEvent) => void;
  readonly disarm: () => void;
  readonly show: () => void;
  readonly close: () => void;
}

export interface ContentTabStopState {
  /** The scroller should be a tab stop: it overflows or holds focus. */
  readonly tabStop: boolean;
  /** floating-ui has parked the portal's tabbables: focus last left it. */
  readonly portalParked: boolean;
}
