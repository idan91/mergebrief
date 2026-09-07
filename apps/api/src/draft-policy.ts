import type { DraftPolicy } from "types";

/**
 * Mirrors `generators`' DEFAULT_DRAFT_POLICY — this package cannot depend on
 * generators (it would pull the adapter family into the api process), so the
 * literal is deliberately duplicated. Keep both sides in sync.
 */
export const DEFAULT_DRAFT_POLICY: DraftPolicy = {
  generate: true,
  debounceSeconds: null,
};
