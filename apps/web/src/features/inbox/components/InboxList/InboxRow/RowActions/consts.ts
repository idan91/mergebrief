import { HeldGenerateNotices } from "@web/features/pulls/consts";
import {
  RegenerateResultKinds,
  type RegenerateNoticeKeys,
} from "@web/features/pulls/types";

/** Generate brief from a held row: the row swaps to Queued, and the page's region says why it did or did not. */
export const HeldRowGenerateNotices: RegenerateNoticeKeys = {
  ...HeldGenerateNotices,
  [RegenerateResultKinds.QUEUED]: "home.inbox.actions.generateQueued",
};
