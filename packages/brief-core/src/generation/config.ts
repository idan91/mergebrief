/**
 * Revision-narrative config gate, shaped as a namespace object so a future
 * per-repo config loader slots in behind the same return type.
 */
export interface RevisionNarrativeConfig {
  enabled: boolean;
}

/** The revision narrative runs unless the instance config turns it off. */
export const DEFAULT_REVISION_NARRATIVE_ENABLED = true;
