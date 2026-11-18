import type { AttachmentAssetId } from "contract";
import type { Result } from "types/utils";
import type { RepoAccess } from "../../../../access/types";
import { parseOwnerAndName } from "../../utils";
import {
  buildRenderedSourcesRequest,
  listRenderedVideoAssetIds,
} from "./logic/rendered-sources";
import {
  ReadAttachmentFailureKinds,
  type ListVideoAssetsDeps,
  type ListVideoAssetsInput,
  type ReadAttachmentWireFailure,
} from "./types";

/**
 * The pasted assets the pull request's rendered bodies show as a video, read
 * on `access.github` as the attachment read is, so a page turns a bare asset
 * line into a player only for an asset GitHub itself played.
 */
export async function listVideoAssets(
  deps: ListVideoAssetsDeps,
  access: RepoAccess,
  input: ListVideoAssetsInput,
): Promise<Result<readonly AttachmentAssetId[], ReadAttachmentWireFailure>> {
  const repo = parseOwnerAndName(access.repoFullName);
  if (repo === undefined) {
    return {
      ok: false,
      error: { kind: ReadAttachmentFailureKinds.ASSET_ABSENT },
    };
  }
  const request = buildRenderedSourcesRequest(access, repo, input.prNumber);
  return listRenderedVideoAssetIds(deps.sources, request, input.missingAssetId);
}
