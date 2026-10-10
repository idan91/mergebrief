import type { ValueOf } from "types/utils";

export interface GroupSummarySegment {
  /** The segment's offset in the source text; unique within one summary. */
  offset: number;
  text: string;
  code: boolean;
}

export const GroupFactsSurfaces = {
  CARD: "card",
  PANEL: "panel",
} as const;

export type GroupFactsSurface = ValueOf<typeof GroupFactsSurfaces>;
