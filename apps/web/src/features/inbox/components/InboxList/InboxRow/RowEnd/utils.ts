import { isWaitingCondition } from "i18n";

import { isNoLongerOpen } from "@web/features/pulls/utils";
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
    | "home.inbox.generation.awaitingTrigger"
    | "home.inbox.generation.held"
    | "home.inbox.generation.waiting"
    | "home.inbox.status.draft"
    | "home.inbox.status.merged"
    | "home.inbox.status.closed";
}

/**
 * Waiting only when every unmet item clears by itself; a list this bundle read
 * only in part, or not at all, may hide one that needs someone, so it is Held.
 */
function readHeldSignal(generation: InboxGeneration): RowSignal {
  const unmet = generation.unmetConditions ?? [];
  const readWhole =
    unmet.length > 0 && generation.unmetConditionsPartial !== true;
  const waitsOnly = readWhole && unmet.every(isWaitingCondition);
  if (waitsOnly) {
    return {
      kind: RowSignalKinds.WAITING,
      label: "home.inbox.generation.waiting",
    };
  }
  return { kind: RowSignalKinds.HELD, label: "home.inbox.generation.held" };
}

/**
 * The generation state worth printing: a brief on its way, one that stopped,
 * or one waiting for a click or for its trigger conditions while the PR is
 * open. A closed or merged PR's waiting head never gets one, so its status
 * signal says it all.
 */
export function readGenerationSignal(
  generation: InboxGeneration | undefined,
  state: InboxItem["state"],
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
    case GenerationStatuses.AWAITING_TRIGGER: {
      if (isNoLongerOpen(state)) {
        return null;
      }
      return {
        kind: RowSignalKinds.AWAITING_TRIGGER,
        label: "home.inbox.generation.awaitingTrigger",
      };
    }
    case GenerationStatuses.HELD: {
      if (isNoLongerOpen(state)) {
        return null;
      }
      return readHeldSignal(generation);
    }
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
