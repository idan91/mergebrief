import type { ReactNode } from "react";

import { VideoAssetsScope } from "@web/components/Markdown/context";
import { useVideoAssetLookup } from "./useVideoAssetLookup";

export interface VideoAssetsProviderProps {
  repoId: string;
  prNumber: number;
  children: ReactNode;
}

/** Confirms which bare asset lines under it GitHub rendered as a video, with one read per page. */
export function VideoAssetsProvider({
  repoId,
  prNumber,
  children,
}: VideoAssetsProviderProps) {
  const videoAssets = useVideoAssetLookup(repoId, prNumber);
  return <VideoAssetsScope value={videoAssets}>{children}</VideoAssetsScope>;
}
