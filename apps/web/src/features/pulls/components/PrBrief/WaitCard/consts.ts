import { WaitReasons, type WaitReason } from "contract";
import type { TranslationKey } from "i18n";
import type { GenerationPhase } from "types/generations";

export const WAIT_REASON_KEYS: Record<WaitReason, TranslationKey> = {
  [WaitReasons.DEBOUNCING]: "pulls.wait.debouncing",
  [WaitReasons.WAITING_FOR_SLOT]: "pulls.wait.waitingForSlot",
};

/** Exhaustive over the stored vocabulary: a new phase fails this typecheck until it has a line. */
const PHASE_KEY_BY_PHASE: Record<GenerationPhase, TranslationKey> = {
  fetching: "pulls.wait.phase.fetching",
  redacting: "pulls.wait.phase.redacting",
  generating: "pulls.wait.phase.generating",
  writing: "pulls.wait.phase.writing",
};

/** Read through a Map: the wire phase is an open string, and a Record would answer `constructor`. */
export const PHASE_KEYS: ReadonlyMap<string, TranslationKey> = new Map(
  Object.entries(PHASE_KEY_BY_PHASE),
);
