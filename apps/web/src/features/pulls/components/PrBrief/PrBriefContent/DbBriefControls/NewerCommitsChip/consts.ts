import { IconNames, type IconName } from "@web/components/Icon/types";
import {
  NewerCommitsActionKinds,
  type NewerCommitsActionKind,
  type RunActionKind,
  type RunActionLabelKeys,
} from "./types";

/** Each action's glyph: the repo's awaiting-trigger and regenerate marks, and a forward arrow. */
export const ActionIcons: Record<NewerCommitsActionKind, IconName> = {
  [NewerCommitsActionKinds.NAVIGATE]: IconNames.ARROW_UP,
  [NewerCommitsActionKinds.GENERATE]: IconNames.CURSOR_CLICK,
  [NewerCommitsActionKinds.RETRY]: IconNames.ARROWS_CLOCKWISE,
};

export const RunActionLabels: Record<RunActionKind, RunActionLabelKeys> = {
  [NewerCommitsActionKinds.GENERATE]: {
    rest: "pulls.newerCommits.action.generate",
    pending: "pulls.newerCommits.action.generatePending",
  },
  [NewerCommitsActionKinds.RETRY]: {
    rest: "pulls.newerCommits.action.retry",
    pending: "pulls.newerCommits.action.retryPending",
  },
};
