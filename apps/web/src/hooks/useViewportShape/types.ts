import type { ValueOf } from "types/utils";

export const ViewportShapes = {
  DESKTOP: "desktop",
  PHONE: "phone",
  LANDSCAPE_PHONE: "landscape-phone",
} as const;

export type ViewportShape = ValueOf<typeof ViewportShapes>;
