import type { TFunction } from "i18next";
import { useCallback, useMemo } from "react";

import type { ReviewFlowStore } from "@web/features/review/session";
import { useLineLinkScroll } from "../line-links/useLineLinkScroll";
import { ScrollHistories } from "../scroll-to-target/types";
import type { AddressSync, ChunkShare, UseAddressSyncInput } from "../types";
import { deriveShareUrl } from "../utils";
import { useAddress } from ".";
import { AddressEventKinds, type AddressHandle } from "./types";
import { useChunkDeepLink } from "./useChunkDeepLink";
import { useFocusArrival } from "./useFocusArrival";

export function useAddressSync(input: UseAddressSyncInput): AddressSync {
  const { t, props, readingState, scope, flow, lineSelection } = input;
  const { briefId } = props.reading;
  const { link, searchParams } = props.address;
  const { session, readingPosition } = readingState;

  const addressHandle = useAddress({
    briefId,
    lineSelection: lineSelection ?? undefined,
    focusMode: session.focusMode,
    scope,
    position: readingPosition,
    url: { link, focus: searchParams.focus === true },
    navigateLink: props.address.navigateLink,
    setFocusParam: props.address.setFocusParam,
  });
  useFocusArrival({
    focusInUrl: searchParams.focus === true,
    link,
    chunkIds: session.chunkIds,
    startReadThrough: session.startReadThrough,
  });

  // A Changes section's jump scrolls to target like a chunk link, with a
  // history step: its button leaves with the pane, so focus goes to the card.
  const { jumpToChunkFromConversation } = input.conversationWiring;
  const queueChunkJumpFromChanges = (chunkId: string) => {
    jumpToChunkFromConversation(
      chunkId,
      undefined,
      "instant",
      ScrollHistories.PUSH,
    );
  };
  const lineLinkScroll = useDeepLinks(input, addressHandle);
  const shareChunk = useChunkShare(t, addressHandle, flow.flowStore);

  return {
    lineLinkMissed: lineLinkScroll.missed,
    dismissLineLinkMiss: lineLinkScroll.dismissMiss,
    shareChunk,
    queueChunkJumpFromChanges,
  };
}

function useDeepLinks(
  input: UseAddressSyncInput,
  addressHandle: AddressHandle,
) {
  const { t, props, readingState, flow } = input;
  const { briefId, fileRows } = props.reading;
  const { session } = readingState;
  const { jumpToChunkFromConversation } = input.conversationWiring;
  const flowActions = flow.flowStore.getState().actions;

  // A link naming a chunk scrolls to target through the conversation scroll:
  // open the card, scroll, focus, flash. Instant, not smooth: the windowed
  // lists mount and measure cards as the viewport passes, and each
  // measurement scroll-adjustment cancels a smooth scroll in flight. An
  // arrival in Changes scope leaves it by replace, since that scope was never
  // a chosen destination. A thread target owns its own arrival.
  const scrollToDeepLink = useCallback(
    (chunkId: string): boolean =>
      jumpToChunkFromConversation(
        chunkId,
        undefined,
        "instant",
        ScrollHistories.REPLACE,
      ),
    [jumpToChunkFromConversation],
  );
  const lineLinkScroll = useLineLinkScroll({
    briefId,
    chunks: session.readingOrderedChunks,
    fileRows,
    rowsSettled: fileRows !== undefined,
    expansionSource: readingState.expansionSource,
    jumpToChunkFromConversation,
    selectLines: flowActions.selectLines,
    expandEdge: readingState.expansion.getState().actions.expandEdge,
    announce: flow.announce,
    announceQuietly: flowActions.announceQuietly,
    address: addressHandle,
    t,
  });
  useChunkDeepLink({
    briefId,
    chunkIds: session.chunkIds,
    link: props.address.link,
    enabled: props.conversation?.focusThreadId === undefined,
    scrollToChunk: scrollToDeepLink,
    scrollToLine: lineLinkScroll.scrollToLine,
    address: addressHandle,
  });

  return lineLinkScroll;
}

/**
 * The chunk glyph: once the URL names the chunk, a line selection stands
 * down in the same task, so it never writes its lines back.
 */
function useChunkShare(
  t: TFunction,
  addressHandle: AddressHandle,
  flowStore: ReviewFlowStore,
) {
  const flowActions = flowStore.getState().actions;
  const commitChunkShare = useCallback(
    (chunkId: string): void => {
      addressHandle.send({ kind: AddressEventKinds.CHUNK_SHARED, chunkId });
      if (flowStore.getState().lineSelection !== null) {
        flowActions.clearLineSelection();
        flowActions.announceQuietly(t("review.announce.lineSelectionCleared"));
      }
    },
    [addressHandle, flowActions, flowStore, t],
  );

  return useMemo<ChunkShare>(
    () => ({
      deriveUrl: (chunkId) => deriveShareUrl(window.location, chunkId),
      commit: commitChunkShare,
    }),
    [commitChunkShare],
  );
}
