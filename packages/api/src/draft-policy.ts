import type { DraftPolicy } from "types";

/**
 * The zero-config draft policy (BRIEF-64), api-local. Mirrors `generators`'
 * DEFAULT_DRAFT_POLICY — this package cannot depend on generators (it would
 * pull the adapter family into the api process), so the two-field literal is
 * deliberately duplicated; both sides document the mirror.
 */
export const DEFAULT_DRAFT_POLICY: DraftPolicy = {
  generate: true,
  debounceSeconds: null,
};
