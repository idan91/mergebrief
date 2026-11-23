import type { Mutable } from "types/utils";
import type { PullRequestRow } from "./tenant";

/** The trigger conditions a PR met once and keeps met; each absent until met. */
export interface ConditionStamps {
  readonly reviewRequestedMetAt?: Date;
  /** The digest of the `paths` globs the PR met; met only while they are unchanged. */
  readonly pathsMetDigest?: string;
}

export function readConditionStamps(
  row: Pick<PullRequestRow, "reviewRequestedMetAt" | "pathsMetDigest">,
): ConditionStamps {
  const stamps: Mutable<ConditionStamps> = {};
  if (row.reviewRequestedMetAt !== null) {
    stamps.reviewRequestedMetAt = row.reviewRequestedMetAt;
  }
  if (row.pathsMetDigest !== null) {
    stamps.pathsMetDigest = row.pathsMetDigest;
  }
  return stamps;
}
