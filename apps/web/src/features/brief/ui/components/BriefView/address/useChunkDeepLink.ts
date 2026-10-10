import { useEffect, useRef } from "react";

import type { LineLinkTarget } from "@web/features/review/utils";
import { AddressEventKinds, type AddressHandle } from "./types";
import { LinkTargetKinds } from "../types";
import { parseLinkParam } from "../utils";

export interface UseChunkDeepLinkInput {
  briefId: string;
  chunkIds: readonly string[];
  /** The link param as the URL carries it; absent means nothing to scroll to. */
  link: string | undefined;
  /** False while another scroll owns the arrival, such as a thread target. */
  enabled: boolean;
  /**
   * Scrolls to the chunk: opens the card, scrolls, focuses. Returns false
   * when it could not schedule the scroll, so the link keeps its one chance.
   */
  scrollToChunk: (chunkId: string) => boolean;
  /** Scrolls to the lines a line link names; the same false keeps the chance. */
  scrollToLine?: ((target: LineLinkTarget) => boolean) | undefined;
  /** A link this page wrote is no arrival; one that does not parse drops here. */
  address?: AddressHandle | undefined;
}

/**
 * A link naming a chunk or a line range scrolls to it once per brief. The
 * windowed cards mount as the viewport passes, so the scroll goes through
 * the app's jump, which asks the windows to mount the card. The one chance
 * is spent by a scheduled scroll or by yielding to another arrival, never
 * by a chunk list that does not carry the id yet. A link that does not
 * parse spends it by leaving the URL.
 */
export function useChunkDeepLink({
  briefId,
  chunkIds,
  link,
  enabled,
  scrollToChunk,
  scrollToLine,
  address,
}: UseChunkDeepLinkInput): void {
  const arrivedFor = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (arrivedFor.current === briefId || link === undefined) {
      return;
    }
    if (address?.isOwnLink(link) === true) {
      arrivedFor.current = briefId;
      return;
    }
    const parsed = parseLinkParam(link);
    if (!parsed.ok) {
      arrivedFor.current = briefId;
      address?.send({ kind: AddressEventKinds.LINK_UNPARSED });
      return;
    }
    if (!enabled) {
      arrivedFor.current = briefId;
      return;
    }
    if (parsed.value.kind === LinkTargetKinds.CHUNK) {
      const { chunkId } = parsed.value;
      if (chunkIds.includes(chunkId) && scrollToChunk(chunkId)) {
        arrivedFor.current = briefId;
      }
      return;
    }
    if (scrollToLine !== undefined && scrollToLine(parsed.value.lines)) {
      arrivedFor.current = briefId;
    }
  }, [address, briefId, chunkIds, enabled, scrollToChunk, scrollToLine, link]);
}
