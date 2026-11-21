import {
  RegenerateResultKinds,
  type RegenerateNoticeKeys,
} from "@web/features/pulls/types";

/** Generate now from a held row: the row swaps to Queued, and the page's region says why it did or did not. */
export const HeldRowGenerateNotices: RegenerateNoticeKeys = {
  [RegenerateResultKinds.QUEUED]: "home.inbox.actions.generateQueued",
  [RegenerateResultKinds.RUNNING]: "pulls.briefError.generation-running",
  [RegenerateResultKinds.NOT_REGENERABLE]: "pulls.held.generate.stale",
  [RegenerateResultKinds.NOT_ALLOWED]:
    "pulls.awaitingTrigger.generate.notAllowed",
  [RegenerateResultKinds.UNAUTHORIZED]:
    "pulls.awaitingTrigger.generate.unauthorized",
  [RegenerateResultKinds.UPSTREAM]: "pulls.awaitingTrigger.generate.upstream",
  [RegenerateResultKinds.INDETERMINATE]:
    "pulls.awaitingTrigger.generate.indeterminate",
};
