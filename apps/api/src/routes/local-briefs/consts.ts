import { LocalBriefKinds, type LocalBriefKind } from "contract";

/** Every artifact id is a filename stem in the out dir; nothing else reaches a path. */
export const BRIEF_ID_PATTERN = /^[A-Za-z0-9._-]+$/;

/** The categorizer names a Brief `<stem>_<index>_<first 8 of the head sha>`. */
export const SHORT_SHA_LENGTH = 8;

export const BRIEF_SUFFIX = ".brief.json";
export const DELTA_SUFFIX = ".delta.json";
export const BRIEF_DIFFS_SUFFIX = ".diffs.json";
export const DELTA_DIFFS_SUFFIX = ".delta.diffs.json";
export const COMPARISON_MARKS_SUFFIX = ".comparison.json";
export const REVISION_CHANGES_SUFFIX = ".revchanges.json";
export const REVISION_NARRATIVE_SUFFIX = ".revision-narrative.json";

export const COMMENTS_SUFFIX_BY_KIND = {
  [LocalBriefKinds.BRIEF]: ".comments.json",
  [LocalBriefKinds.DELTA]: ".delta.comments.json",
} as const satisfies Record<LocalBriefKind, string>;

/** The longest filename, in bytes, common filesystems accept; ids are ASCII. */
const FILENAME_MAX_BYTES = 255;

const ID_SUFFIXES = [
  BRIEF_SUFFIX,
  DELTA_SUFFIX,
  BRIEF_DIFFS_SUFFIX,
  DELTA_DIFFS_SUFFIX,
  COMPARISON_MARKS_SUFFIX,
  REVISION_CHANGES_SUFFIX,
  REVISION_NARRATIVE_SUFFIX,
  ...Object.values(COMMENTS_SUFFIX_BY_KIND),
];
const LONGEST_ID_SUFFIX_LENGTH = Math.max(
  ...ID_SUFFIXES.map((suffix) => suffix.length),
);

/** Past this, the longest suffixed filename overflows and the read throws. */
export const MAX_BRIEF_ID_LENGTH =
  FILENAME_MAX_BYTES - LONGEST_ID_SUFFIX_LENGTH;

export const NO_STORE = { "cache-control": "no-store" } as const;

export const ARTIFACT_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  ...NO_STORE,
} as const;
