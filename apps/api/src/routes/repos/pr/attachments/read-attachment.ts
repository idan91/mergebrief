import { AttachmentSourceKinds } from "contract";
import type { RepositoryRef } from "github";
import type { Mutable, Result } from "types/utils";
import type { RepoAccess } from "../../../../access/types";
import { parseOwnerAndName } from "../../utils";
import {
  fetchAttachmentBytes,
  readBranchAttachment,
} from "./logic/fetch-attachment";
import {
  buildRenderedSourcesRequest,
  resolveRenderedSource,
} from "./logic/rendered-sources";
import { wrapBytesFailure, wrapDenial } from "./logic/read-failures";
import {
  ReadAttachmentFailureKinds,
  type AssetReadInput,
  type AttachmentBytes,
  type ReadAttachmentDeps,
  type ReadAttachmentFailure,
  type ReadAttachmentInput,
  type UpstreamBytesRequest,
} from "./types";

type ReadResult = Result<AttachmentBytes, ReadAttachmentFailure>;

/**
 * The bytes come from a URL GitHub already signed, so that fetch carries no
 * credential. The asset's type is unknown until upstream answers, so only a
 * client's own `Range` is forwarded; a video asked for whole is cut to its
 * first piece by the route.
 */
async function readAsset(
  deps: ReadAttachmentDeps,
  access: RepoAccess,
  repo: RepositoryRef,
  { prNumber, assetId, bytes }: AssetReadInput,
): Promise<ReadResult> {
  const sources = buildRenderedSourcesRequest(access, repo, prNumber);
  const request = { ...sources, assetId };
  const source = await resolveRenderedSource(deps.sources, request);
  if (!source.ok) {
    return source;
  }

  const upstream: Mutable<UpstreamBytesRequest> = { signal: bytes.signal };
  if (bytes.rangeRequested) {
    upstream.range = bytes.upstreamRange;
  }
  const fetched = await fetchAttachmentBytes(
    deps.fetch,
    source.value,
    upstream,
  );
  return wrapBytesFailure(fetched);
}

/**
 * The attachment a comment shows, streamed. The rendered sources read on
 * `access.github`, whose operator rung covers only the granted PR; a branch
 * file needs no source, so a file still in a draft serves the same way.
 */
export async function readAttachment(
  deps: ReadAttachmentDeps,
  access: RepoAccess,
  input: ReadAttachmentInput,
): Promise<ReadResult> {
  const repo = parseOwnerAndName(access.repoFullName);
  if (repo === undefined) {
    return {
      ok: false,
      error: { kind: ReadAttachmentFailureKinds.ASSET_ABSENT },
    };
  }

  const { target } = input;
  if (target.kind === AttachmentSourceKinds.BRANCH) {
    const file = { ...repo, file: target.file };
    const fetched = await readBranchAttachment(
      deps.fetch,
      access.credential,
      file,
      input.bytes.signal,
    );
    return wrapDenial(fetched);
  }
  const asset = {
    prNumber: input.prNumber,
    assetId: target.assetId,
    bytes: input.bytes,
  };
  return readAsset(deps, access, repo, asset);
}
