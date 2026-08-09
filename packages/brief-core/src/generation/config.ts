/**
 * Revision-narrative config gate. Env-backed for now, shaped as a namespace
 * object so a future per-repo config loader slots in behind this same return
 * type without changing callers.
 */
export interface RevisionNarrativeConfig {
  enabled: boolean;
}

const DISABLED_VALUES = new Set(["false", "0", "off", "no"]);

export function revisionNarrativeConfig(): RevisionNarrativeConfig {
  const raw = process.env["REVISION_NARRATIVE_ENABLED"];
  const enabled = raw == null ? true : !DISABLED_VALUES.has(raw.toLowerCase());
  return { enabled };
}
