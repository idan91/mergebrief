import { AttachmentSourceKinds } from "contract";
import type { GitHubCallFailure, RepositoryRef } from "github";
import type { Result } from "types/utils";
import type { RepoAccess } from "../../../../access/types";
import { parseOwnerAndName } from "../../utils";
import {
  fetchAttachmentBytes,
  readBranchAttachment,
} from "./logic/fetch-attachment";
import { resolveRenderedSource } from "./logic/rendered-sources";
import {
  ReadAttachmentFailureKinds,
  type AssetReadInput,
  type AttachmentBytes,
  type ReadAttachmentDeps,
  type ReadAttachmentFailure,
  type ReadAttachmentInput,
} from "./types";

type ReadResult = Result<AttachmentBytes, ReadAttachmentFailure>;

function wrapDenial(
  fetched: Result<AttachmentBytes, GitHubCallFailure>,
): ReadResult {
  if (fetched.ok) {
    return fetched;
  }
  const kind = ReadAttachmentFailureKinds.GITHUB_DENIED;
  return { ok: false, error: { kind, error: fetched.error } };
}

/** The bytes come from a URL GitHub already signed, so that fetch carries no credential. */
async function readAsset(
  deps: ReadAttachmentDeps,
  access: RepoAccess,
  repo: RepositoryRef,
  { prNumber, assetId }: AssetReadInput,
): Promise<ReadResult> {
  const sessionTokenHash = access.session.sessionTokenHash;
  const cacheKey = `${sessionTokenHash}:${String(access.repoId)}:${prNumber}`;
  const reader = access.github.forRepo(repo);
  const request = { cacheKey, reader, prNumber, assetId };
  const source = await resolveRenderedSource(deps.sources, request);
  if (!source.ok) {
    return source;
  }

  const fetched = await fetchAttachmentBytes(deps.fetch, source.value);
  return wrapDenial(fetched);
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
    );
    return wrapDenial(fetched);
  }
  const asset = { prNumber: input.prNumber, assetId: target.assetId };
  return readAsset(deps, access, repo, asset);
}
