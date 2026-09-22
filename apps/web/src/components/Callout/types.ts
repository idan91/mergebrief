import type { PointerEvent } from "react";

export interface CalloutHover {
  readonly open: boolean;
  readonly arm: (event: PointerEvent) => void;
  readonly disarm: () => void;
  readonly show: () => void;
  readonly close: () => void;
}
