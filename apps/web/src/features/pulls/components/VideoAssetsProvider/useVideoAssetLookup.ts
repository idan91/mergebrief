import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { AttachmentAssetId } from "contract";
import { useCallback, useMemo, useRef, useState } from "react";

import type { VideoAssets } from "@web/components/Markdown/context";
import {
  buildVideoAssetsQueryOptions,
  refetchVideoAssetsForMissing,
} from "../../queries";
import { readVideoAssetIdSet } from "./utils";

type PullRequestKey = `${string}/${number}`;

/** The ids already asked again by name, for the one pull request they were asked on. */
interface ReAskedAssetIds {
  readonly pullRequest: PullRequestKey;
  readonly ids: Set<AttachmentAssetId>;
}

/**
 * The pull request's video assets, read on the first bare asset line's ask.
 * An id an answer lacks is asked once more by name, whether its line mounted
 * before or after that answer: it may have been posted after the read, and
 * the API's own copy of the sources may predate it too. Every ask is tagged
 * with its pull request, so moving to another one starts unasked.
 */
export function useVideoAssetLookup(
  repoId: string,
  prNumber: number,
): VideoAssets {
  const pullRequest: PullRequestKey = `${repoId}/${prNumber}`;
  const [requestedFor, setRequestedFor] = useState<PullRequestKey>();
  const reAsked = useRef<ReAskedAssetIds | undefined>(undefined);
  const queryClient = useQueryClient();
  const { data: videoAssetIds } = useQuery({
    ...buildVideoAssetsQueryOptions(repoId, prNumber),
    enabled: requestedFor === pullRequest,
    select: readVideoAssetIdSet,
  });

  const requestVideoAssets = useCallback(
    (assetId: AttachmentAssetId) => {
      setRequestedFor(pullRequest);
      if (reAsked.current?.pullRequest !== pullRequest) {
        reAsked.current = { pullRequest, ids: new Set() };
      }
      const reAskedIds = reAsked.current.ids;
      const missingFromAnswer =
        videoAssetIds !== undefined && !videoAssetIds.has(assetId);
      if (!missingFromAnswer || reAskedIds.has(assetId)) {
        return;
      }

      reAskedIds.add(assetId);
      void refetchVideoAssetsForMissing(queryClient, repoId, prNumber, assetId);
    },
    [prNumber, pullRequest, queryClient, repoId, videoAssetIds],
  );

  return useMemo(
    () => ({ videoAssetIds, requestVideoAssets }),
    [requestVideoAssets, videoAssetIds],
  );
}
