// Hono-free. The rendered sources are a read: the operator PAT is the second
// rung when the gate passed this request on it, as the diff proxy does, and
// an asset's bytes then come from a URL GitHub already signed, with no
// credential. A branch file is read with the viewer's own token only.
import { ATTACHMENT_BRANCH, buildAttachmentBranchUrl } from "contract";
import { fetchRenderedImageSources } from "github";
import type { Result } from "types/utils";
import {
  buildGitHubDeniedResult,
  isGitHubDenial,
} from "../../../../shared-errors/failures";
import { resolveRepoOwnerAndName } from "../../logic/resolve-repo-owner-and-name";
import { SOURCES_REFETCH_MIN_AGE_MS, SOURCES_TTL_MS } from "./consts";
import {
  fetchAttachmentBytes,
  fetchBranchAttachmentBytes,
} from "./logic/fetch-attachment";
import { resolveAttachmentSource } from "./logic/resolve-source";
import {
  ReadAttachmentFailureKinds,
  type AttachmentBytes,
  type AttachmentsControllerDeps,
  type ReadAttachmentFailure,
  type ReadAttachmentInput,
  type ReadBranchAttachmentInput,
  type RenderedSources,
  type UploadAttachmentFailure,
  type UploadAttachmentInput,
  type UploadControllerDeps,
  type UploadedAttachment,
} from "./types";

type SourcesResult = Result<RenderedSources, ReadAttachmentFailure>;

async function fetchSources(
  deps: AttachmentsControllerDeps,
  input: ReadAttachmentInput,
): Promise<SourcesResult> {
  const fetched = await deps.github.runRead(
    (token) =>
      fetchRenderedImageSources(deps.github.createOctokit(token), {
        owner: input.owner,
        repo: input.repo,
        prNumber: input.prNumber,
      }),
    isGitHubDenial,
  );
  if (fetched.ok) {
    return {
      ok: true,
      value: { sources: fetched.value, fetchedAt: Date.now() },
    };
  }
  if (fetched.tokenUnreadable) {
    return {
      ok: false,
      error: { kind: ReadAttachmentFailureKinds.TOKEN_UNREADABLE },
    };
  }

  return {
    ok: false,
    error: {
      kind: ReadAttachmentFailureKinds.GITHUB_DENIED,
      error: fetched.error,
    },
  };
}

/**
 * One GitHub call per key at a time: a cold page fires every <img> at once,
 * and each would otherwise run the whole query before the first could cache.
 */
function fetchSourcesOnce(
  deps: AttachmentsControllerDeps,
  input: ReadAttachmentInput,
  cacheKey: string,
): Promise<SourcesResult> {
  const running = deps.sourcesInFlight.get(cacheKey);
  if (running !== undefined) {
    return running;
  }
  const pending = fetchSources(deps, input).finally(() => {
    deps.sourcesInFlight.delete(cacheKey);
  });
  deps.sourcesInFlight.set(cacheKey, pending);
  return pending;
}

/**
 * The PR's rendered sources, cached per viewer and PR. A miss inside a live
 * entry refetches, since the screenshot may have been posted after the entry
 * was cached, but only once the entry is old enough: an asset outside the
 * query's windows would otherwise re-run the query on every render.
 */
async function resolveSource(
  deps: AttachmentsControllerDeps,
  input: ReadAttachmentInput,
): Promise<Result<string, ReadAttachmentFailure>> {
  const cacheKey = `${input.sessionTokenHash}:${deps.repoId}:${input.prNumber}`;
  const cached = deps.sourcesCache.get(cacheKey);
  if (cached !== undefined) {
    const source = resolveAttachmentSource(cached.sources, input.assetId);
    if (source !== undefined) {
      return { ok: true, value: source };
    }
    const recentlyFetched =
      Date.now() - cached.fetchedAt < SOURCES_REFETCH_MIN_AGE_MS;
    if (recentlyFetched) {
      return {
        ok: false,
        error: { kind: ReadAttachmentFailureKinds.ASSET_ABSENT },
      };
    }
  }

  const fresh = await fetchSourcesOnce(deps, input, cacheKey);
  if (!fresh.ok) {
    return fresh;
  }
  deps.sourcesCache.set(
    cacheKey,
    fresh.value,
    fresh.value.fetchedAt + SOURCES_TTL_MS,
  );

  const source = resolveAttachmentSource(fresh.value.sources, input.assetId);
  if (source === undefined) {
    return {
      ok: false,
      error: { kind: ReadAttachmentFailureKinds.ASSET_ABSENT },
    };
  }
  return { ok: true, value: source };
}

async function readAttachment(
  deps: AttachmentsControllerDeps,
  input: ReadAttachmentInput,
): Promise<Result<AttachmentBytes, ReadAttachmentFailure>> {
  const source = await resolveSource(deps, input);
  if (!source.ok) {
    return source;
  }

  const bytes = await fetchAttachmentBytes(deps.fetchImpl, source.value);
  if (bytes.ok) {
    return bytes;
  }
  return {
    ok: false,
    error: {
      kind: ReadAttachmentFailureKinds.GITHUB_DENIED,
      error: bytes.error,
    },
  };
}

/**
 * A branch file needs no rendered source: the proxy path names the file and
 * the gate names the repo, so a file still in a draft serves the same way.
 * The read carries the viewer's own token and never the operator PAT: the
 * PAT rung is granted per pull request, and a branch file is not tied to
 * one, so borrowing it would serve any file on the branch to a reader the
 * gate passed for a single pull request.
 */
async function readBranchAttachment(
  deps: AttachmentsControllerDeps,
  input: ReadBranchAttachmentInput,
): Promise<Result<AttachmentBytes, ReadAttachmentFailure>> {
  const fetched = await deps.github.run((token) =>
    fetchBranchAttachmentBytes(deps.fetchImpl, token, input),
  );
  if (fetched.ok) {
    return { ok: true, value: fetched.value };
  }
  if (fetched.tokenUnreadable) {
    return {
      ok: false,
      error: { kind: ReadAttachmentFailureKinds.TOKEN_UNREADABLE },
    };
  }

  return {
    ok: false,
    error: {
      kind: ReadAttachmentFailureKinds.GITHUB_DENIED,
      error: fetched.error,
    },
  };
}

/**
 * The repo is re-resolved fresh with the viewer's token right before the
 * push, as every outward write does; the push itself rides the App's
 * installation token, so the commit is the App's and never the viewer's.
 */
async function uploadAttachment(
  deps: UploadControllerDeps,
  input: UploadAttachmentInput,
): Promise<Result<UploadedAttachment, UploadAttachmentFailure>> {
  const resolved = await resolveRepoOwnerAndName(
    { github: deps.reviewer },
    input.repoId,
  );
  if (!resolved.ok) {
    return resolved;
  }
  const { owner, repo } = resolved.value;

  const committed = await deps.port.commitAttachment(input.installationId, {
    owner,
    repo,
    branch: ATTACHMENT_BRANCH,
    path: input.file.fileName,
    bytes: input.bytes,
  });
  if (!committed.ok) {
    return buildGitHubDeniedResult(committed.error, "mutation");
  }

  const url = buildAttachmentBranchUrl({
    owner,
    repo,
    fileName: input.file.fileName,
  });
  return { ok: true, value: { url } };
}

export const attachmentsController = {
  readAttachment,
  readBranchAttachment,
  uploadAttachment,
};
