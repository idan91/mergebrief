import type { OpenChangeReason } from "@floating-ui/react";
import { useRef, type PointerEvent } from "react";

import type { DetailsSurface, DetailsSurfaceState } from "../types";
import { isReplaceableByPreview, pickLeaveTarget } from "../utils";
import { useSurfaceMove } from "./useSurfaceMove";

export function useDetailsSurface(
  surfaceId: string,
  chipEl: HTMLButtonElement | null,
  triggerEl: HTMLButtonElement | null,
): DetailsSurfaceState {
  const { openSurface, moveTo, pinOpen, isPinned, getLatestSurface } =
    useSurfaceMove(surfaceId, chipEl, triggerEl);
  const hoveredSurface = useRef<DetailsSurface | undefined>(undefined);

  // A surface that unmounts under a resting pointer sends its hover area no
  // leave, so an explicit move forgets the hover until the next enter.
  const close = () => {
    hoveredSurface.current = undefined;
    moveTo(undefined);
  };
  const closeFromCallout = (
    surface: DetailsSurface,
    reason?: OpenChangeReason,
  ) => {
    if (getLatestSurface() !== surface) {
      return;
    }
    if (reason === "escape-key") {
      close();
      return;
    }

    moveTo(pickLeaveTarget(surface, hoveredSurface.current, reason));
  };
  const pin = (surface: DetailsSurface) => {
    hoveredSurface.current = undefined;
    moveTo(surface);
    pinOpen();
  };
  const toggle = (surface: DetailsSurface) => {
    if (getLatestSurface() === surface) {
      close();
    } else {
      pin(surface);
    }
  };
  const previewOnHover = (
    surface: DetailsSurface,
    pointerType: PointerEvent["pointerType"],
  ) => {
    if (pointerType !== "mouse") {
      return;
    }

    hoveredSurface.current = surface;
    const replaceable = isReplaceableByPreview(
      getLatestSurface(),
      surface,
      isPinned(),
    );
    if (replaceable) {
      moveTo(surface);
    }
  };
  const endHover = (surface: DetailsSurface) => {
    if (hoveredSurface.current === surface) {
      hoveredSurface.current = undefined;
    }
  };

  return {
    openSurface,
    close,
    closeFromCallout,
    pin,
    pinOpen,
    isPinned,
    toggle,
    previewOnHover,
    endHover,
  };
}
