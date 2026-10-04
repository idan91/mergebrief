import { join } from "node:path";
import type { Result } from "types/utils";

import { DEFAULT_BRANCH_REF, NOTES_EXTENSION, RELEASES_DIR } from "../consts";
import {
  type BumpLevel,
  BumpLevels,
  type CutError,
  type CutPlan,
  type GitPort,
  type ReleaseVersion,
} from "../types";
import { GitCommandError } from "./git-port";
import { parseReleaseNotes } from "./notes";
import {
  formatReleaseTag,
  formatReleaseVersion,
  isStableVersion,
  parseReleaseVersion,
  pickHighestStable,
} from "./version";

export interface CutOptions {
  readonly level: BumpLevel;
  /** A commit on the default branch; the fetched tip of that branch when absent. */
  readonly ref?: string;
  readonly candidate: boolean;
}

const NO_RELEASE_YET: ReleaseVersion = { major: 0, minor: 0, patch: 0 };

function bumpVersion(base: ReleaseVersion, level: BumpLevel): ReleaseVersion {
  if (level === BumpLevels.MAJOR) {
    return { major: base.major + 1, minor: 0, patch: 0 };
  }
  if (level === BumpLevels.MINOR) {
    return { major: base.major, minor: base.minor + 1, patch: 0 };
  }
  return { major: base.major, minor: base.minor, patch: base.patch + 1 };
}

function isSameTriple(left: ReleaseVersion, right: ReleaseVersion): boolean {
  const same =
    left.major === right.major &&
    left.minor === right.minor &&
    left.patch === right.patch;
  return same;
}

/**
 * The version a bump produces over the tags already published: the
 * highest stable tag bumped by `level` (`0.0.0` when none exists), and for
 * a candidate the next `rc.N` of that bumped version.
 */
export function computeNextVersion(
  tags: readonly string[],
  level: BumpLevel,
  candidate: boolean,
): ReleaseVersion {
  const published = tags
    .map((tag) => parseReleaseVersion(tag))
    .filter((version) => version !== undefined);
  const base = pickHighestStable(published) ?? NO_RELEASE_YET;
  const bumped = bumpVersion(base, level);
  if (!candidate) {
    return bumped;
  }

  const highestRc = published
    .filter(
      (version) => !isStableVersion(version) && isSameTriple(version, bumped),
    )
    .reduce((highest, version) => Math.max(highest, version.rc ?? 0), 0);
  return { ...bumped, rc: highestRc + 1 };
}

/**
 * Everything the cut will do, refused before any tag is written: the
 * remote's default branch is fetched first and its tip is the commit
 * unless `--at` names another commit on it (a stale clone's HEAD is never
 * tagged by accident), the notes file for the computed version exists AT
 * THAT COMMIT and parses, and no local tag of that name exists (the remote
 * cannot hold one: the version is always above every tag it listed).
 */
export function planCut(
  git: GitPort,
  options: CutOptions,
): Result<CutPlan, CutError> {
  git.fetchDefaultBranch();

  const ref = options.ref ?? DEFAULT_BRANCH_REF;
  const commit = git.resolveCommit(ref);
  if (commit === undefined) {
    return { ok: false, error: { reason: `${ref} is not a commit` } };
  }
  const offBranch = !git.isOnDefaultBranch(commit);
  if (offBranch) {
    const reason = `${commit} is not on the default branch; tag the merge commit`;
    return { ok: false, error: { reason } };
  }

  const tags = git.listRemoteTags();
  const version = computeNextVersion(tags, options.level, options.candidate);
  const text = formatReleaseVersion(version);
  const tag = formatReleaseTag(version);
  const tagTaken = git.hasLocalTag(tag);
  if (tagTaken) {
    const reason = `${tag} already exists locally; delete it or push it by hand`;
    return { ok: false, error: { reason } };
  }

  const notesPath = join(RELEASES_DIR, `${text}${NOTES_EXTENSION}`);
  const notesText = git.readFileAt(commit, notesPath);
  if (notesText === undefined) {
    const reason = `${notesPath} is not in ${commit}; merge the notes file first`;
    return { ok: false, error: { reason } };
  }
  const notes = parseReleaseNotes(notesPath, notesText);
  if (!notes.ok) {
    return {
      ok: false,
      error: { reason: `${notesPath}: ${notes.error.reason}` },
    };
  }

  return { ok: true, value: { version: text, tag, commit, notesPath } };
}

/**
 * Writes the tag the plan names, then pushes it when asked. A push that
 * fails leaves the local tag in place and says so, since the rerun would
 * otherwise refuse on the tag it just created.
 */
export function executeCut(
  git: GitPort,
  plan: CutPlan,
  push: boolean,
): Result<void, CutError> {
  git.createTag(plan.tag, plan.commit);
  if (!push) {
    return { ok: true, value: undefined };
  }

  try {
    git.pushTag(plan.tag);
  } catch (cause) {
    if (!(cause instanceof GitCommandError)) {
      throw cause;
    }
    const reason = `${plan.tag} is tagged locally but the push failed (${cause.detail}); retry with: git push origin ${plan.tag}`;
    return { ok: false, error: { reason } };
  }
  return { ok: true, value: undefined };
}
