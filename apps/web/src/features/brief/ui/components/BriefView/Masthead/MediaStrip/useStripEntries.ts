import { extractMedia } from "brief-core/media";
import { useEffect, useMemo } from "react";

import {
  useAttachmentScope,
  useVideoAssets,
} from "@web/components/Markdown/context";
import type { Brief } from "../../../../../model/types";
import type { StripEntry } from "./types";
import { buildStripEntries, readPendingVideoAssetIds } from "./utils";

/**
 * The strip's entries for the brief's stored description, extracted once per
 * description. A pasted asset line asks GitHub whether it rendered a video,
 * since the Original description that would otherwise ask stays closed.
 */
export function useStripEntries(brief: Brief): readonly StripEntry[] {
  const { description, repo } = brief.pr;
  const scope = useAttachmentScope();
  const videoAssets = useVideoAssets();
  const videoAssetIds = videoAssets?.videoAssetIds;
  const requestVideoAssets = videoAssets?.requestVideoAssets;

  const items = useMemo(
    () => extractMedia(description, { repoSlug: repo }),
    [description, repo],
  );

  useEffect(() => {
    if (requestVideoAssets === undefined) {
      return;
    }
    for (const assetId of readPendingVideoAssetIds(items)) {
      requestVideoAssets(assetId);
    }
  }, [items, requestVideoAssets]);

  return useMemo(
    () => buildStripEntries(items, scope, videoAssetIds),
    [items, scope, videoAssetIds],
  );
}
