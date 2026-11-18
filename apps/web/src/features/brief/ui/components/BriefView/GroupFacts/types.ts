import type { ValueOf } from "types/utils";

export const GroupFactsSurfaces = {
  CARD: "card",
  PANEL: "panel",
} as const;

export type GroupFactsSurface = ValueOf<typeof GroupFactsSurfaces>;
