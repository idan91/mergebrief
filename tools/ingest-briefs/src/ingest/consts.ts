// The CLI's artifact file-name grammar. Each pattern names its captures, so
// the mapper reads coordinates off the name rather than re-splitting strings.

export const BRIEF_FILE =
  /^(?<stem>.+)_(?<index>\d+)_(?<head8>[0-9a-f]{8})\.brief\.json$/;
export const NARRATIVE_FILE =
  /^(?<stem>.+)_(?<index>\d+)_(?<head8>[0-9a-f]{8})\.revision-narrative\.json$/;
export const COMPARISON_FILE =
  /^(?<stem>.+)_(?:previous-brief|checkpoint)_(?<a8>[0-9a-f]{8})-(?<b8>[0-9a-f]{8})\.comparison\.json$/;
export const REVCHANGES_FILE =
  /^(?<stem>.+)_(?<index>\d+)_(?<head8>[0-9a-f]{8})\.revchanges\.json$/;
export const DELTA_FILE =
  /^(?<stem>.+)-(?<base8>[0-9a-f]{8})\.\.(?<head8>[0-9a-f]{8})\.delta\.json$/;
export const ANY_BRIEF_SUFFIX = /\.brief\.json$/;
export const DELTA_SIDECAR = /\.delta\.(?:diffs|comments)\.json$/;

/** Stamped on artifacts written before the generation origin was recorded. */
export const UNKNOWN_ORIGIN = {
  provider: "unknown",
  model: "unknown",
  effort: "unknown",
} as const;
