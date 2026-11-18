// Thread-state chip derivations, shared by the section digest and the
// promoted ThreadRowView. Chips carry TEXT (WCAG 1.4.1) and stay factual:
// `resolved` never dresses as success.
import {
  ReviewVerdictStates,
  type ReviewVerdictState,
} from "types/conversation";
import type { TranslationKey } from "i18n";
import type { DigestRow } from "./digest";
import {
  type ConversationThread,
  type ThreadState,
  ThreadStates,
} from "../types";

/** Review verdict chip text, the digest's own verdict vocabulary. */
export const VERDICT_LABEL_KEYS: Readonly<
  Record<ReviewVerdictState, TranslationKey>
> = {
  [ReviewVerdictStates.APPROVED]: "conversation.verdict.approved",
  [ReviewVerdictStates.CHANGES_REQUESTED]:
    "conversation.verdict.changesRequested",
  [ReviewVerdictStates.COMMENTED]: "conversation.verdict.commented",
  [ReviewVerdictStates.DISMISSED]: "conversation.verdict.dismissed",
};

export const THREAD_STATE_LABEL_KEYS: Readonly<
  Record<ThreadState, TranslationKey>
> = {
  [ThreadStates.OPEN]: "conversation.threadState.open",
  [ThreadStates.RESOLVED]: "conversation.threadState.resolved",
  [ThreadStates.OUTDATED]: "conversation.threadState.outdated",
};

/**
 * GitHub facts wear GitHub words. A resolved+outdated thread reads as
 * outdated: that is why it left the code view.
 */
export function deriveThreadState(thread: ConversationThread): ThreadState {
  if (thread.isOutdated) {
    return ThreadStates.OUTDATED;
  }
  return thread.isResolved ? ThreadStates.RESOLVED : ThreadStates.OPEN;
}

/**
 * The collapsed bot-group chip must stay factual for the WHOLE group: an
 * all-outdated group reads outdated even when its threads are unresolved
 * (outdated is WHY they left the code view); otherwise open wins over
 * resolved.
 */
export function deriveBotGroupState(
  row: Extract<DigestRow, { kind: "bot-group" }>,
): ThreadState {
  if (row.threads.every((threadRow) => threadRow.thread.isOutdated)) {
    return ThreadStates.OUTDATED;
  }
  return row.openCount > 0 ? ThreadStates.OPEN : ThreadStates.RESOLVED;
}
