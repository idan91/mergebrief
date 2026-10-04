import type { Mutable } from "types/utils";

import {
  type ReleaseChannel,
  ReleaseChannels,
  type ReleaseVersion,
} from "../types";

// The release grammar: `X.Y.Z` or `X.Y.Z-rc.N`, no leading zeros, optional
// `v`. Deliberately narrower than the api's `parseSemver`, which drops any
// suffix; a tag that reaches the registry must be one of these two shapes.
const RELEASE_VERSION_PATTERN =
  /^v?(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})(?:-rc\.(0|[1-9]\d{0,8}))?$/;

const STABLE_RANK = Number.POSITIVE_INFINITY;

export function parseReleaseVersion(text: string): ReleaseVersion | undefined {
  const match = RELEASE_VERSION_PATTERN.exec(text.trim());
  if (match === null) {
    return undefined;
  }
  const [, major, minor, patch, rc] = match;
  if (major === undefined || minor === undefined || patch === undefined) {
    return undefined;
  }

  const version: Mutable<ReleaseVersion> = {
    major: Number(major),
    minor: Number(minor),
    patch: Number(patch),
  };
  if (rc !== undefined) {
    version.rc = Number(rc);
  }
  return version;
}

export function formatReleaseVersion(version: ReleaseVersion): string {
  const triple = `${version.major}.${version.minor}.${version.patch}`;
  const text = version.rc === undefined ? triple : `${triple}-rc.${version.rc}`;
  return text;
}

export function formatReleaseTag(version: ReleaseVersion): string {
  const tag = `v${formatReleaseVersion(version)}`;
  return tag;
}

export function isStableVersion(version: ReleaseVersion): boolean {
  return version.rc === undefined;
}

export function resolveChannel(version: ReleaseVersion): ReleaseChannel {
  const stable = isStableVersion(version);
  return stable ? ReleaseChannels.STABLE : ReleaseChannels.RC;
}

/** Negative when `left` is older; a candidate is older than its release. */
export function compareReleaseVersions(
  left: ReleaseVersion,
  right: ReleaseVersion,
): number {
  if (left.major !== right.major) {
    return left.major - right.major;
  }
  if (left.minor !== right.minor) {
    return left.minor - right.minor;
  }
  if (left.patch !== right.patch) {
    return left.patch - right.patch;
  }

  const leftRank = left.rc ?? STABLE_RANK;
  const rightRank = right.rc ?? STABLE_RANK;
  if (leftRank === rightRank) {
    return 0;
  }
  return leftRank < rightRank ? -1 : 1;
}

export function pickHighestStable(
  versions: readonly ReleaseVersion[],
): ReleaseVersion | undefined {
  let highest: ReleaseVersion | undefined;
  for (const version of versions) {
    const stable = isStableVersion(version);
    if (!stable) {
      continue;
    }
    const newer =
      highest === undefined || compareReleaseVersions(version, highest) > 0;
    if (newer) {
      highest = version;
    }
  }
  return highest;
}
