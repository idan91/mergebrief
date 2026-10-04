// The one semver grammar for a MergeBrief version string. The api's update
// check and the instance version row both compare with it; the CLI carries
// its own copy because its bundle takes no workspace runtime dependency.
import type { Result } from "types";
import type { Semver } from "./types";

export type { Semver } from "./types";

const SEMVER_PATTERN =
  /^v?(\d{1,9})\.(\d{1,9})\.(\d{1,9})(?:\+[0-9A-Za-z.-]+)?$/;
const PRERELEASE_PATTERN = /^v?\d{1,9}\.\d{1,9}\.\d{1,9}-/;
const NOT_SEMVER = "not major.minor.patch";
const PRERELEASE = "a prerelease is not a release";

/**
 * A release is `major.minor.patch`, a leading `v` and `+build` metadata
 * allowed. A `-prerelease` suffix is refused on its own reason: the release
 * model has none, and dropping it would make an RC compare equal to the
 * release it precedes.
 */
export function parseSemver(value: string): Result<Semver, string> {
  const text = value.trim();
  if (PRERELEASE_PATTERN.test(text)) {
    return { ok: false, error: PRERELEASE };
  }
  const match = SEMVER_PATTERN.exec(text);
  if (match === null) {
    return { ok: false, error: NOT_SEMVER };
  }
  const [, major, minor, patch] = match;
  if (major === undefined || minor === undefined || patch === undefined) {
    return { ok: false, error: NOT_SEMVER };
  }
  return {
    ok: true,
    value: { major: Number(major), minor: Number(minor), patch: Number(patch) },
  };
}

/** Negative when `left` is older, positive when newer, zero when equal. */
export function compareSemver(left: Semver, right: Semver): number {
  if (left.major !== right.major) {
    return left.major - right.major;
  }
  if (left.minor !== right.minor) {
    return left.minor - right.minor;
  }
  return left.patch - right.patch;
}

/** The canonical `major.minor.patch` text. */
export function formatSemver(version: Semver): string {
  return `${version.major}.${version.minor}.${version.patch}`;
}

const DEV_SENTINEL = "dev";

/** `dev` and `0.0.0` (a leading `v` included) are the dev sentinels: never a release. */
export function isDevVersion(value: string): boolean {
  const isSentinel = value.trim() === DEV_SENTINEL;
  if (isSentinel) {
    return true;
  }
  const parsed = parseSemver(value);
  if (!parsed.ok) {
    return false;
  }
  const { major, minor, patch } = parsed.value;
  const isZero = major === 0 && minor === 0 && patch === 0;
  return isZero;
}
