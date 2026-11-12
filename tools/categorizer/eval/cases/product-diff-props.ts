import {
  ProductDiffAvailabilities,
  type Brief,
  type ProductChange,
} from "brief-core/types";
import type { EvalProperty } from "../properties";

/**
 * Queries and property builders for the Product diff cases. A row's text is
 * model prose, so a case finds a row by a loose pattern over its when and
 * after: a before says what a change replaced, so another row's before can
 * name the thing too. Every such property also needs the section read, so an
 * absent or unavailable section fails it. One that asks for no such row
 * passes with no rows, and its case anchors it with one that needs a row.
 */

const INBOX_POLL_PATTERN =
  /\bpoll|every 30|30[- ]second|while the (tab|page) is visible|without a (refocus|reload)/i;
/** An outcome that states the cadence is the poll's own row, whatever else it mentions. */
const POLL_CADENCE_PATTERN = /every 30|30[- ]second/i;
/** A read that failed or came back signed out: the condition of a row that only mentions the poll. */
const UNREAD_CONDITION =
  /fail|error|could not|cannot|refus|signed[- ]out|signs? (\w+ ){1,2}out/i;
/** The cursor rows of the same diff say what a poll no longer does to the cursor. */
const CURSOR_ASIDE_PATTERN = /cursor|scroll/i;
const CURSOR_PATTERN = /cursor/i;

export function isProductDiffAvailable(brief: Brief): boolean {
  return (
    brief.productDiff?.availability === ProductDiffAvailabilities.AVAILABLE
  );
}

/** The section's rows when it was read; none when it is absent or unavailable. */
export function listProductChanges(brief: Brief): ProductChange[] {
  if (!isProductDiffAvailable(brief)) {
    return [];
  }

  return brief.productDiff?.changes ?? [];
}

function matchesChangeText(change: ProductChange, pattern: RegExp): boolean {
  return pattern.test(`${change.when} ${change.after}`);
}

/** A row about the list's own poll, never one that mentions it in passing. */
function isInboxPollChange(change: ProductChange): boolean {
  const statesCadence = POLL_CADENCE_PATTERN.test(change.after);
  const namesPoll = matchesChangeText(change, INBOX_POLL_PATTERN);
  const namesCursor = matchesChangeText(change, CURSOR_ASIDE_PATTERN);
  const namesPollAlone = namesPoll && !namesCursor;
  const isPollRow = statesCadence || namesPollAlone;

  const isUnreadRow = UNREAD_CONDITION.test(change.when);
  const isInboxPoll = isPollRow && !isUnreadRow;
  return isInboxPoll;
}

/** A row about the keyboard cursor, never a failed read that says the cursor survived it. */
function isCursorChange(change: ProductChange): boolean {
  const namesCursor = matchesChangeText(change, CURSOR_PATTERN);
  const isUnreadRow = UNREAD_CONDITION.test(change.when);
  const isCursorRow = namesCursor && !isUnreadRow;
  return isCursorRow;
}

function namesOnlyKnownGroups(
  change: ProductChange,
  groupIds: ReadonlySet<string>,
): boolean {
  const unknown = change.groupIds.filter((groupId) => !groupIds.has(groupId));
  const namesOnlyKnown = change.groupIds.length > 0 && unknown.length === 0;
  return namesOnlyKnown;
}

/** The rows whose when or after matches `pattern`. */
export function findProductChanges(
  brief: Brief,
  pattern: RegExp,
): ProductChange[] {
  const changes = listProductChanges(brief);
  return changes.filter((change) => matchesChangeText(change, pattern));
}

/** The rows about the inbox list's 30-second poll in the inbox poll diff. */
export function findInboxPollChanges(brief: Brief): ProductChange[] {
  return listProductChanges(brief).filter(isInboxPollChange);
}

/** The rows about the keyboard cursor in the inbox poll diff. */
export function findCursorChanges(brief: Brief): ProductChange[] {
  return listProductChanges(brief).filter(isCursorChange);
}

export function buildAvailableProperty(): EvalProperty {
  return {
    id: "product-diff-available",
    description:
      "a one-call brief carries a read Product diff: the call ran and its answer survived the trim",
    check: isProductDiffAvailable,
  };
}

/**
 * The trim drops an unknown id and a row left with none, so a failure here is
 * a pipeline bug, never model judgment.
 */
export function buildGroupIdsProperty(): EvalProperty {
  return {
    id: "product-change-groups-real",
    description:
      "the section is read and every listed change names at least one change-group, each one a group of this brief",
    check: (brief) => {
      const groupIds = new Set(brief.changeGroups.map((group) => group.id));
      const changes = listProductChanges(brief);
      const namesRealGroups = changes.every((change) =>
        namesOnlyKnownGroups(change, groupIds),
      );
      const isReadWithRealGroups =
        isProductDiffAvailable(brief) && namesRealGroups;
      return isReadWithRealGroups;
    },
  };
}
