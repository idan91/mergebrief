/**
 * Revision-narrative config gate (ADR 0024, cost control per ADR 0023).
 *
 * DEVIATION FROM PLAN (flagged for the handoff): the plan's target shape is a
 * per-repo YAML namespace —
 *
 * ```yaml
 * revisionNarrative:
 *   enabled: true
 * ```
 *
 * — but no per-repo YAML loader exists yet anywhere in the stateless CLI (ADR
 * 0013 explicitly defers it: "the stateless dogfood CLI keeps env + flags for
 * now; YAML is the product-runtime shape"). Building a YAML loader is out of
 * scope for this stage. This is the minimal honest stand-in: an env var,
 * default on, shaped as a namespace object so a future YAML loader slots in
 * behind this same `RevisionNarrativeConfig` return type without changing any
 * caller.
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
