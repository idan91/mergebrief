import { type RefObject, useEffect, useRef } from "react";

import type { LineLinkTarget } from "@web/features/review/utils";
import { LinkTargetKinds } from "./types";
import { parseLinkParam } from "./utils";

export interface UseChunkDeepLinkInput {
  briefId: string;
  chunkIds: readonly string[];
  /** The link param as the URL carries it; absent means nothing to land. */
  link: string | undefined;
  /** False while another landing owns the arrival, such as a thread target. */
  enabled: boolean;
  /**
   * Lands on the chunk: opens the card, scrolls, focuses. Returns false when
   * it could not schedule a landing, so the link keeps its one chance.
   */
  land: (chunkId: string) => boolean;
  /** Lands on the lines a line link names; the same false keeps the chance. */
  landLine?: ((target: LineLinkTarget) => boolean) | undefined;
  /** The link this page last wrote itself; arriving on it is not an arrival. */
  writtenLink?: RefObject<string | undefined> | undefined;
  /** Replaces the link param; undefined drops it. */
  navigateLink?: ((link: string | undefined) => void) | undefined;
}

/**
 * A link naming a chunk or a line range lands on it once per brief. The
 * windowed cards mount as the viewport passes, so the landing goes through
 * the app's jump, which asks the windows to mount the card. The one chance
 * is spent by a scheduled landing or by yielding to another arrival, never
 * by a chunk list that does not carry the id yet. A link that does not
 * parse spends it by leaving the URL.
 */
export function useChunkDeepLink({
  briefId,
  chunkIds,
  link,
  enabled,
  land,
  landLine,
  writtenLink,
  navigateLink,
}: UseChunkDeepLinkInput): void {
  const landedFor = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (landedFor.current === briefId || link === undefined) {
      return;
    }
    if (writtenLink?.current === link) {
      landedFor.current = briefId;
      return;
    }
    const parsed = parseLinkParam(link);
    if (!parsed.ok) {
      landedFor.current = briefId;
      navigateLink?.(undefined);
      return;
    }
    if (!enabled) {
      landedFor.current = briefId;
      return;
    }
    if (parsed.value.kind === LinkTargetKinds.CHUNK) {
      const { chunkId } = parsed.value;
      if (chunkIds.includes(chunkId) && land(chunkId)) {
        landedFor.current = briefId;
      }
      return;
    }
    if (landLine !== undefined && landLine(parsed.value.lines)) {
      landedFor.current = briefId;
    }
  }, [
    briefId,
    chunkIds,
    enabled,
    land,
    landLine,
    link,
    navigateLink,
    writtenLink,
  ]);
}
