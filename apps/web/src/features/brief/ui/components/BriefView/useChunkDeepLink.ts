import { useEffect, useRef } from "react";

import type { LineLinkTarget } from "@web/features/review/utils";
import { AddressEventKinds, type AddressHandle } from "./address/types";
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
  /** A link this page wrote is no arrival; one that does not parse drops here. */
  address?: AddressHandle | undefined;
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
  address,
}: UseChunkDeepLinkInput): void {
  const landedFor = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (landedFor.current === briefId || link === undefined) {
      return;
    }
    if (address?.isOwnLink(link) === true) {
      landedFor.current = briefId;
      return;
    }
    const parsed = parseLinkParam(link);
    if (!parsed.ok) {
      landedFor.current = briefId;
      address?.send({ kind: AddressEventKinds.LINK_UNPARSED });
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
  }, [address, briefId, chunkIds, enabled, land, landLine, link]);
}
