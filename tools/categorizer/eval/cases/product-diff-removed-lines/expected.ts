import { BeforeSources } from "brief-core/types";
import type { EvalProperty } from "../../properties";
import {
  buildAvailableProperty,
  buildGroupIdsProperty,
  findCursorChanges,
  findInboxPollChanges,
} from "../product-diff-props";

/**
 * code-review#1311: the inbox list polls every 30 seconds while the tab is
 * visible, and the keyboard cursor follows its row. Removed comments read "the
 * list itself never polls" and "the cursor is the index into the rows", so the
 * poll's before is in the diff. Each row property needs a listed row, so an
 * absent or empty section fails it. `inbox-poll-before-from-diff` needs a poll
 * row with a before sourced `diff`; `did-not-exist` does not count.
 * `product-diff-pr-text-contradicts` reuses this diff.
 */
export const properties: EvalProperty[] = [
  buildAvailableProperty(),
  {
    id: "inbox-poll-listed",
    description:
      "the inbox list's new poll while the tab is visible is a listed Product change",
    check: (brief) => findInboxPollChanges(brief).length > 0,
  },
  {
    id: "inbox-poll-before-shown",
    description:
      "the poll row states a before: the removed lines show that the list did not poll",
    check: (brief) =>
      findInboxPollChanges(brief).some((change) => change.before !== undefined),
  },
  {
    id: "inbox-poll-before-from-diff",
    description:
      "the poll row's before is sourced from the diff, read off the removed comments",
    check: (brief) =>
      findInboxPollChanges(brief).some(
        (change) =>
          change.before !== undefined &&
          change.beforeSource === BeforeSources.DIFF,
      ),
  },
  {
    id: "cursor-follows-row-listed",
    description:
      "the keyboard cursor staying on its row when rows move is a listed Product change",
    check: (brief) => findCursorChanges(brief).length > 0,
  },
  buildGroupIdsProperty(),
];
