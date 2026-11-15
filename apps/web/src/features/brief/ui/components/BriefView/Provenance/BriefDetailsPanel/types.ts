import type { OpenChangeReason } from "@floating-ui/react";
import type { PointerEvent } from "react";
import type { ValueOf } from "types/utils";

/** What the disclosure has open: the facts behind the ⓘ, or the chip's warnings. */
export const DetailsSurfaces = {
  FACTS: "facts",
  WARNINGS: "warnings",
} as const;
export type DetailsSurface = ValueOf<typeof DetailsSurfaces>;

export interface DetailsSurfaceState {
  openSurface: DetailsSurface | undefined;
  close: () => void;
  /**
   * Closes `surface` only while it is still the open one. Escape closes it
   * as `close` does; after a pointer leave it previews the other trigger's
   * surface if the mouse is on it.
   */
  closeFromCallout: (
    surface: DetailsSurface,
    reason?: OpenChangeReason,
  ) => void;
  pin: (surface: DetailsSurface) => void;
  /** Pins the surface already open, without moving. */
  pinOpen: () => void;
  isPinned: () => boolean;
  toggle: (surface: DetailsSurface) => void;
  previewOnHover: (
    surface: DetailsSurface,
    pointerType: PointerEvent["pointerType"],
  ) => void;
  endHover: (surface: DetailsSurface) => void;
}

/** The open surface and the moves that change it, focus return included. */
export interface SurfaceMove {
  openSurface: DetailsSurface | undefined;
  /** Opens `next`, or closes on `undefined`, and drops any pin. */
  moveTo: (next: DetailsSurface | undefined) => void;
  pinOpen: () => void;
  isPinned: () => boolean;
  /** The surface last moved to, ahead of the render that shows it. */
  getLatestSurface: () => DetailsSurface | undefined;
}
