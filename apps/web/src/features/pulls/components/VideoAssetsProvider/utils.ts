import type { AttachmentAssetId, VideoAssetsResponse } from "contract";

/** The answer's ids as the set a bare asset line is looked up in. */
export function readVideoAssetIdSet(
  response: VideoAssetsResponse,
): ReadonlySet<AttachmentAssetId> {
  return new Set(response.assetIds);
}
