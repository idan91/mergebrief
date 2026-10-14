import { GenerationStatuses, PrStates } from "types";
import type { InboxGeneration, InboxItem } from "../../../../types";
import { RowSignalKinds, type RowSignalKind } from "./types";

export interface RowSignal {
  readonly kind: RowSignalKind;
  readonly label:
    | "home.inbox.generation.queued"
    | "home.inbox.generation.generating"
    | "home.inbox.generation.failed"
    | "home.inbox.generation.capped"
    | "home.inbox.status.draft"
    | "home.inbox.status.merged"
    | "home.inbox.status.closed";
}

/** The generation state worth printing: a brief on its way, or one that stopped. */
export function readGenerationSignal(
  generation: InboxGeneration | undefined,
): RowSignal | null {
  switch (generation?.status) {
    case GenerationStatuses.PENDING:
      return {
        kind: RowSignalKinds.QUEUED,
        label: "home.inbox.generation.queued",
      };
    case GenerationStatuses.RUNNING:
      return {
        kind: RowSignalKinds.RUNNING,
        label: "home.inbox.generation.generating",
      };
    case GenerationStatuses.FAILED:
      return {
        kind: RowSignalKinds.FAILED,
        label: "home.inbox.generation.failed",
      };
    case GenerationStatuses.CAPPED:
      return {
        kind: RowSignalKinds.CAPPED,
        label: "home.inbox.generation.capped",
      };
    default:
      return null;
  }
}

/** The status when it is not Open; merged and closed outrank a stale draft flag. */
export function readStatusSignal(
  state: InboxItem["state"],
  draft: boolean,
): RowSignal | null {
  if (state === PrStates.MERGED) {
    return { kind: RowSignalKinds.MERGED, label: "home.inbox.status.merged" };
  }
  if (state === PrStates.CLOSED) {
    return { kind: RowSignalKinds.CLOSED, label: "home.inbox.status.closed" };
  }
  if (draft) {
    return { kind: RowSignalKinds.DRAFT, label: "home.inbox.status.draft" };
  }
  return null;
}
