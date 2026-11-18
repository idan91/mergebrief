import { RepoFileKinds } from "github";
import type { Logger } from "logging";
import type { PullRequestSource } from "../../github-port";
import { GITATTRIBUTES_MAX_BYTES, GITATTRIBUTES_PATH } from "../consts";
import { GitAttributesReadings, type GitAttributesRead } from "../types";
import { isRepoFileRefusedForGood } from "./errors";

type GitAttributesReads = Pick<PullRequestSource, "fetchRepoFile">;

/**
 * The DEFAULT branch's `.gitattributes`, the one a multi-call run reads
 * generated and vendored files by: a PR head never decides how much of its
 * own code is read. Absent, too large or refused for good means every file
 * is read in full, so a missing file degrades the outline, never the
 * scrutiny. A read a retry may clear is told apart: the engine still reads
 * every file in full, but a multi-call run must not store or compare parts
 * under a digest of a file it never saw.
 */
export async function readDefaultBranchGitAttributes(
  source: GitAttributesReads,
  log: Logger,
): Promise<GitAttributesRead> {
  const read = await source.fetchRepoFile(
    GITATTRIBUTES_PATH,
    GITATTRIBUTES_MAX_BYTES,
  );
  if (!read.ok && isRepoFileRefusedForGood(read.error)) {
    log.warn(
      `generate: ${GITATTRIBUTES_PATH} refused for good, every file is read in full`,
      { code: read.error.code },
    );
    return { kind: GitAttributesReadings.NONE };
  }
  if (!read.ok) {
    log.warn(
      `generate: ${GITATTRIBUTES_PATH} unreadable (${read.error.message}), every file is read in full`,
    );
    return { kind: GitAttributesReadings.UNREAD, error: read.error.message };
  }

  const file = read.value;
  if (file.kind === RepoFileKinds.TOO_LARGE) {
    log.warn(
      `generate: ${GITATTRIBUTES_PATH} over its ${GITATTRIBUTES_MAX_BYTES}-byte cap (${file.size} bytes), every file is read in full`,
    );
    return { kind: GitAttributesReadings.NONE };
  }
  if (file.kind === RepoFileKinds.ABSENT) {
    return { kind: GitAttributesReadings.NONE };
  }
  return { kind: GitAttributesReadings.CONTENT, text: file.content };
}
