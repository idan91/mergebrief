// The API-side shapes behind the session payload: the row slice a draft is
// built from, and the lists a payload carries before materialization is
// accounted for. The wire shapes themselves live in `contract`.
import type {
  AnchorStatus,
  DraftAnchor,
  DraftCommentStatus,
} from "persistence";
import type { SessionPayload } from "contract";

/** The row fields a draft payload is shaped from, either side of materialization. */
export interface DraftCommentSource {
  readonly id: bigint;
  readonly anchor: DraftAnchor;
  readonly body: string;
  readonly status: DraftCommentStatus;
  readonly anchorStatus: AnchorStatus | null;
}

/** The lists a payload carries, before materialization is accounted for. */
export type SessionWork = Omit<
  SessionPayload,
  "materialized" | "carriedFrom" | "attention"
>;
