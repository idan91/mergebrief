/**
 * Revision-narrative config gate, shaped as a namespace object so a future
 * per-repo config loader slots in behind the same return type.
 */
export interface RevisionNarrativeConfig {
  enabled: boolean;
}

const DISABLED_VALUES = new Set(["false", "0", "off", "no"]);

/** Reads the `REVISION_NARRATIVE_ENABLED` value a composition root passes in. */
export function parseRevisionNarrativeFlag(
  raw: string | undefined,
): RevisionNarrativeConfig {
  const enabled =
    raw === undefined ? true : !DISABLED_VALUES.has(raw.toLowerCase());
  return { enabled };
}
