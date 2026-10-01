import { useEffect, useRef, type RefObject } from "react";

import type { ReadingPositionStore } from "./readingPosition";
import { isLineLink, resolveLinkChunkId } from "./utils";

export interface UseFocusAddressInput {
  focusMode: boolean;
  /** The focus param as the URL carries it. */
  focusInUrl: boolean;
  setFocusParam: ((focus: boolean) => void) | undefined;
  /** The link param as the URL carries it. */
  link: string | undefined;
  navigateLink: ((link: string | undefined) => void) | undefined;
  /** The link this page last wrote; see useChunkDeepLink. */
  writtenLink: RefObject<string | undefined>;
  chunkIds: readonly string[];
  position: ReadingPositionStore;
  /** A live line selection owns the link param while it lasts. */
  lineSelected: boolean;
  /** Changes scope reads cards, and a chunk link would pull a reload out of it. */
  inChangesScope: boolean;
  startReadThrough: () => void;
}

/**
 * Keeps focus mode and its chunk in the URL, so a reload or a pasted link
 * reopens the same chunk in focus mode. State writes the URL, never the
 * reverse, and every write replaces.
 */
export function useFocusAddress({
  focusMode,
  focusInUrl,
  setFocusParam,
  link,
  navigateLink,
  writtenLink,
  chunkIds,
  position,
  lineSelected,
  inChangesScope,
  startReadThrough,
}: UseFocusAddressInput): void {
  const arrival = useRef({ focusInUrl, link, chunkIds, startReadThrough });

  // A link that names a chunk here lands through useChunkDeepLink; without
  // one, focus mode opens on the first chunk.
  useEffect(() => {
    const landing = arrival.current;
    if (!landing.focusInUrl) {
      return;
    }
    const linkChunkId = resolveLinkChunkId(landing.link);
    const linkLands =
      linkChunkId !== undefined && landing.chunkIds.includes(linkChunkId);
    if (!linkLands) {
      landing.startReadThrough();
    }
  }, []);

  useEffect(() => {
    if (setFocusParam !== undefined && focusInUrl !== focusMode) {
      setFocusParam(focusMode);
    }
  }, [focusInUrl, focusMode, setFocusParam]);

  // Runs once the URL is in Changes scope, so it never races the scope write.
  useEffect(() => {
    const ownChunkLink =
      link !== undefined && link === writtenLink.current && !isLineLink(link);
    const leaving = focusMode && inChangesScope && ownChunkLink;
    if (leaving && navigateLink !== undefined) {
      writtenLink.current = undefined;
      navigateLink(undefined);
    }
  }, [focusMode, inChangesScope, link, navigateLink, writtenLink]);

  useEffect(() => {
    if (!focusMode || lineSelected || inChangesScope) {
      return;
    }
    if (navigateLink === undefined) {
      return;
    }

    // The store notifies inside a landing, before its line selection exists;
    // a link already naming the chunk, alone or with lines, is left as is.
    const follow = (chunkId: string | null) => {
      const named =
        resolveLinkChunkId(link) === chunkId ||
        resolveLinkChunkId(writtenLink.current) === chunkId;
      if (chunkId === null || named) {
        return;
      }
      writtenLink.current = chunkId;
      navigateLink(chunkId);
    };

    follow(position.getState().activeChunkId);
    return position.subscribe((state, previous) => {
      if (state.activeChunkId !== previous.activeChunkId) {
        follow(state.activeChunkId);
      }
    });
  }, [
    focusMode,
    inChangesScope,
    lineSelected,
    link,
    navigateLink,
    position,
    writtenLink,
  ]);
}
