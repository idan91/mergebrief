/** Parsed from `mergebrief.config.yaml`'s `drafts` block. Default lives in generators. */
export interface DraftPolicy {
  readonly generate: boolean;
  readonly debounceSeconds: number | null;
}
