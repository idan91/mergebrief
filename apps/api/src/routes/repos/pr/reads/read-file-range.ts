import type { FileRangeView } from "contract";
import { RepoFileKinds } from "github";
import type { Result } from "types/utils";
import type { PullRequestAccess } from "../../../../access/types";
import { parseOwnerAndName } from "../../utils";
import { FILE_BLOB_CACHE_TTL_MS, FILE_BLOB_MAX_BYTES } from "./consts";
import {
  classifyFileReadFailure,
  classifyRepoFile,
  sliceFileRange,
  splitFileLines,
} from "./logic/file-range";
import { buildFileBlobCacheKey } from "./logic/keys";
import type { FileRangeQuery } from "./schemas";
import type { FileRangeFailure, ReadFileRangeDeps } from "./types";

/**
 * One file's line window at `ref` on the viewer's binding. The split blob is
 * held per session so the file's OTHER hunk edge costs no GitHub call; only
 * the window crosses the wire. Behind an operator pass the binding falls
 * back only at a full SHA recorded for the granted PR; the path is not bound.
 */
export async function readFileRange(
  deps: ReadFileRangeDeps,
  access: PullRequestAccess,
  query: FileRangeQuery,
): Promise<Result<FileRangeView, FileRangeFailure>> {
  const repo = parseOwnerAndName(access.repoFullName);
  if (repo === undefined) {
    return { ok: false, error: { kind: "not-found" } };
  }

  const cacheKey = buildFileBlobCacheKey({
    sessionTokenHash: access.session.sessionTokenHash,
    repoId: access.repoId,
    ref: query.ref,
    path: query.path,
  });
  const now = Date.now();
  const cached = deps.fileCache.get(cacheKey, now);
  if (cached !== undefined) {
    return { ok: true, value: sliceFileRange(cached, query) };
  }

  const fetched = await access.github.forRepo(repo).fetchRepoFile({
    path: query.path,
    ref: query.ref,
    maxBytes: FILE_BLOB_MAX_BYTES,
  });
  if (!fetched.ok) {
    return { ok: false, error: classifyFileReadFailure(fetched.error) };
  }

  const file = fetched.value;
  const refused = classifyRepoFile(file);
  if (refused !== undefined) {
    return { ok: false, error: refused };
  }
  if (file.kind !== RepoFileKinds.FILE) {
    return { ok: false, error: { kind: "file-absent" } };
  }

  const lines = splitFileLines(file.content);
  deps.fileCache.set(cacheKey, lines, now + FILE_BLOB_CACHE_TTL_MS, now);
  return { ok: true, value: sliceFileRange(lines, query) };
}
