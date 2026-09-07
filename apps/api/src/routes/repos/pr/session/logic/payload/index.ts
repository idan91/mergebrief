// Compose the session payload from the store snapshot (or the carried
// preview) — the one entry the controller reads.
export * from "./types";
// The session read's wire shape, built from either side of materialization: a
// session's own rows, or the carry-over verdicts held in memory. The two
// differ only in whether a subject has a row id yet, so one payload type
// covers both and `materialized` is what tells them apart.
import { type ReviewSessionView } from "persistence";
import { deriveAttentionItems } from "../attention";
import { shapeCarriedWork, shapeStoredWork } from "./shape-work";
import type { SessionPayload } from "./types";

export function buildSessionPayload(
  view: ReviewSessionView,
  headIndex: number,
): SessionPayload {
  const source = view.session ?? view.carried;
  const from = view.carriedFrom;
  return {
    materialized: view.session !== undefined,
    carriedFrom:
      from === undefined
        ? null
        : {
            sessionId: String(from.sessionId),
            headSha: from.headSha,
            revisions: headIndex - from.headIndex,
            items: from.items,
          },
    ...(view.session === undefined
      ? shapeCarriedWork(view.carried)
      : shapeStoredWork(view.session)),
    attention: deriveAttentionItems(source),
  };
}
