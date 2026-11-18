import type { OpenChangeReason } from "@floating-ui/react";
import type { TFunction } from "i18next";
import type { Brief } from "../../../../../model/types";
import { ANCHOR_WARNING_KEYS } from "./consts";
import type { DetailsSurface } from "./types";

/**
 * Every warning line the panel lists and the chip counts: the anchor
 * warnings in the reader's language first, then the pipeline's own lines,
 * each once.
 */
export function listWarningLines(t: TFunction, brief: Brief): string[] {
  const anchorLines = (brief.anchorWarnings ?? []).map((warning) =>
    t(ANCHOR_WARNING_KEYS[warning]),
  );
  return [...new Set([...anchorLines, ...(brief.generationWarnings ?? [])])];
}

export function isReplaceableByPreview(
  openSurface: DetailsSurface | undefined,
  hoveredSurface: DetailsSurface,
  pinned: boolean,
): boolean {
  if (openSurface === undefined) {
    return true;
  }

  const otherSurface = openSurface !== hoveredSurface;
  return otherSurface && !pinned;
}

/**
 * Where a closing surface hands over: a pointer that left it for the other
 * trigger previews that trigger's surface; focus moving out only closes.
 */
export function pickLeaveTarget(
  surface: DetailsSurface,
  hoveredSurface: DetailsSurface | undefined,
  reason: OpenChangeReason | undefined,
): DetailsSurface | undefined {
  const pointerLeft = reason === "hover" || reason === "safe-polygon";
  const hoveringSameTrigger = hoveredSurface === surface;
  if (!pointerLeft || hoveringSameTrigger) {
    return undefined;
  }

  return hoveredSurface;
}
