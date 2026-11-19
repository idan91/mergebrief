import type {
  DispositionPayload,
  DraftCommentPayload,
  ReclassificationPayload,
} from "contract";
import type { ReviewOutcome } from "types";

/** One span's session as the demo holds it in the tab. */
export interface DemoSessionRecord {
  materialized: boolean;
  reviewOutcome: ReviewOutcome;
  draftComments: DraftCommentPayload[];
  readMarks: Set<string>;
  reclassifications: Map<string, ReclassificationPayload>;
  dispositions: Map<string, DispositionPayload>;
}

/** The `(base, head)` a session write and read name. */
export interface DemoSessionSpan {
  readonly base: string;
  readonly head: string;
}
