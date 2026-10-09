import type { RevisionNarrativeSkipReason } from "brief-core/types";
import type { CompareParam } from "./types";
import type { ComparisonMarkFiles, ComparisonSource } from "./runs";

/** The comparison overlay state shared down the story view, keyed by the active Compare baseline. */
export interface ComparisonOverlayState {
  compare: CompareParam;
  /** Highlighting derives only from these; null while the overlay is off or unavailable. */
  marks: ComparisonMarkFiles | null;
  source: ComparisonSource;
  /** Null unless the Previous-Brief narrative was skipped on purpose (huge span or config). */
  skipReason: RevisionNarrativeSkipReason | null;
  available: boolean;
  runCount: number;
}
