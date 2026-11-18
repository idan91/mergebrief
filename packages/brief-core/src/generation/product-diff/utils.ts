import {
  BeforeSources,
  MAX_ANSWERED_PRODUCT_CHANGES,
  MAX_PRODUCT_CHANGES,
  ProductDiffAvailabilities,
  type BeforeSource,
  type ChangeGroup,
  type ProductChange,
  type ProductDiff,
  type ProductDiffGeneration,
} from "../../types";
import {
  createGroupIdRestorer,
  sanitizeUntrustedLine,
} from "../untrusted-text";
import { ISSUE_QUOTE_MAX_CHARS, PRODUCT_CHANGE_TEXT_LIMIT } from "./consts";
import type {
  CheckedProductDiff,
  ListedChangeGroup,
  WrittenProductDiff,
} from "./types";

const UNAVAILABLE_PRODUCT_DIFF: ProductDiff = {
  availability: ProductDiffAvailabilities.UNAVAILABLE,
  changes: [],
  hasMore: false,
};

/** The section of a brief whose diff no call read whole: it states no before and no after. */
export function buildUnavailableProductDiff(): ProductDiff {
  return structuredClone(UNAVAILABLE_PRODUCT_DIFF);
}

function shapeProductChange(
  generated: ProductDiffGeneration["changes"][number],
): ProductChange {
  const { before, ...rest } = generated;
  const change: ProductChange = { ...rest };

  if (before !== "") {
    change.before = before;
  }
  return change;
}

/** The answer in its stored shape: the wire's "" before becomes an absent one. */
export function fanOutProductDiff(
  generated: ProductDiffGeneration,
): WrittenProductDiff {
  return {
    changes: generated.changes.map(shapeProductChange),
    hasMore: generated.hasMore,
  };
}

function quoteWhen(change: ProductChange): string {
  const when = change.when.trim();
  const isShort = when.length <= ISSUE_QUOTE_MAX_CHARS;
  const shown = isShort ? when : `${when.slice(0, ISSUE_QUOTE_MAX_CHARS)}...`;
  return JSON.stringify(shown);
}

/** The group ids the brief has, or nothing when the change names none of them. */
function keepKnownGroupIds(
  change: ProductChange,
  knownIds: ReadonlySet<string>,
  issues: string[],
): string[] | undefined {
  const kept = change.groupIds.filter((groupId) => knownIds.has(groupId));
  if (kept.length === 0) {
    issues.push(
      `product change ${quoteWhen(change)} names no change-group of this brief: dropped`,
    );
    return undefined;
  }

  const unknown = change.groupIds.filter((groupId) => !knownIds.has(groupId));
  if (unknown.length > 0) {
    issues.push(
      `product change ${quoteWhen(change)} names unknown change-group(s) ${unknown.join(", ")}: dropped from it`,
    );
  }
  return kept;
}

/** The sources a change may claim with no before: nothing showed it, or the behaviour is new and the source says so. */
const SOURCES_WITHOUT_BEFORE: ReadonlySet<BeforeSource> = new Set([
  BeforeSources.NOT_SHOWN,
  BeforeSources.DID_NOT_EXIST,
]);

/** A before only where the source says one was shown, and a diff or PR-text source only beside a before. */
function reconcileBefore(
  change: ProductChange,
  issues: string[],
): Pick<ProductChange, "before" | "beforeSource"> {
  const before = change.before?.trim() ?? "";

  if (before === "") {
    if (SOURCES_WITHOUT_BEFORE.has(change.beforeSource)) {
      return { beforeSource: change.beforeSource };
    }
    issues.push(
      `product change ${quoteWhen(change)} has no before but claims source ${change.beforeSource}: read as not shown`,
    );
    return { beforeSource: BeforeSources.NOT_SHOWN };
  }
  if (change.beforeSource === BeforeSources.NOT_SHOWN) {
    issues.push(
      `product change ${quoteWhen(change)} states a before it marks as not shown: before removed`,
    );
    return { beforeSource: BeforeSources.NOT_SHOWN };
  }
  return { before: change.before, beforeSource: change.beforeSource };
}

function listOverlongText(change: ProductChange): string[] {
  const fields: [string, string | undefined][] = [
    ["when", change.when],
    ["before", change.before],
    ["after", change.after],
  ];
  return fields
    .filter(([, text]) => (text?.length ?? 0) > PRODUCT_CHANGE_TEXT_LIMIT)
    .map(
      ([field, text]) =>
        `product change ${quoteWhen(change)}: ${field} runs ${text?.length ?? 0} characters, past ${PRODUCT_CHANGE_TEXT_LIMIT}`,
    );
}

function checkProductChange(
  change: ProductChange,
  knownIds: ReadonlySet<string>,
  issues: string[],
): ProductChange | undefined {
  const isBlank = change.when.trim() === "" || change.after.trim() === "";
  if (isBlank) {
    issues.push("product change with an empty when or after: dropped");
    return undefined;
  }

  const groupIds = keepKnownGroupIds(change, knownIds, issues);
  if (groupIds === undefined) {
    return undefined;
  }

  const { before: _unchecked, ...rest } = change;
  const checked: ProductChange = {
    ...rest,
    ...reconcileBefore(change, issues),
    groupIds,
  };
  issues.push(...listOverlongText(checked));
  return checked;
}

/** Two rows are one change when their condition and outcome read the same, whatever the case or spacing. */
function buildChangeKey(change: ProductChange): string {
  const when = normalizeRowText(change.when);
  const after = normalizeRowText(change.after);
  return `${when}\n${after}`;
}

function normalizeRowText(text: string): string {
  return text.trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * The changes the brief lists: the first that pass the check, up to the cap.
 * The answer lists every change it found, so a row past the cap is the
 * ordinary case: it is counted as left out and never reported on.
 */
function takeListedChanges(
  changes: readonly ProductChange[],
  knownIds: ReadonlySet<string>,
  issues: string[],
) {
  const kept: ProductChange[] = [];
  const seenKeys = new Set<string>();
  let leftOut = false;

  for (const change of changes) {
    const isFull = kept.length === MAX_PRODUCT_CHANGES;
    const rowIssues = isFull ? [] : issues;
    const checked = checkNewChange(change, knownIds, seenKeys, rowIssues);
    if (checked === undefined) {
      continue;
    }
    if (isFull) {
      leftOut = true;
      break;
    }
    kept.push(checked);
  }
  return { kept, leftOut };
}

/** A change that passes the check and says something no earlier row said. */
function checkNewChange(
  change: ProductChange,
  knownIds: ReadonlySet<string>,
  seenKeys: Set<string>,
  issues: string[],
): ProductChange | undefined {
  const checked = checkProductChange(change, knownIds, issues);
  if (checked === undefined) {
    return undefined;
  }

  const key = buildChangeKey(checked);
  if (seenKeys.has(key)) {
    issues.push(
      `product change ${quoteWhen(checked)} repeats an earlier one: dropped`,
    );
    return undefined;
  }
  seenKeys.add(key);
  return checked;
}

/**
 * The warn-only pass over the section a call wrote: every check trims or
 * reports, none fails, and what comes back always parses under the stored
 * schema.
 */
export function validateProductDiff(
  written: WrittenProductDiff,
  groups: readonly Pick<ChangeGroup, "id">[],
): CheckedProductDiff {
  const issues: string[] = [];
  const groupIds = groups.map((group) => group.id);
  const knownIds = new Set(groupIds);
  const restoreGroupId = createGroupIdRestorer(groupIds);
  const changes = written.changes.map((change) => ({
    ...change,
    groupIds: change.groupIds.map(restoreGroupId),
  }));
  const { kept, leftOut } = takeListedChanges(changes, knownIds, issues);

  // The call may claim more only past the bound it lists to; below it, every
  // change it found is in the answer and the cut alone decides.
  const answered = written.changes.length;
  const listedAllItMay = answered >= MAX_ANSWERED_PRODUCT_CHANGES;
  const claimsMore = written.hasMore && listedAllItMay;
  const claimsMoreUnbacked = written.hasMore && !listedAllItMay;
  if (claimsMoreUnbacked) {
    issues.push(
      `product diff says the PR has more but lists ${answered} of the ${MAX_ANSWERED_PRODUCT_CHANGES} it may: read as none left out`,
    );
  }

  const hasMore = kept.length > 0 && (claimsMore || leftOut);
  const checked: ProductDiff = {
    availability: ProductDiffAvailabilities.AVAILABLE,
    changes: kept,
    hasMore,
  };
  return { productDiff: checked, issues };
}

/** The wire's own spelling of an absent before, so a copied row stays an empty one. */
const ABSENT_BEFORE = '""';

function renderPreviousChange(change: ProductChange): string {
  const before =
    change.before === undefined
      ? ABSENT_BEFORE
      : sanitizeUntrustedLine(change.before);
  return [
    `- when: ${sanitizeUntrustedLine(change.when)}`,
    `  before: ${before}`,
    `  beforeSource: ${change.beforeSource}`,
    `  after: ${sanitizeUntrustedLine(change.after)}`,
    `  affects: ${change.affects}`,
  ].join("\n");
}

/**
 * The previous revision's Product changes for an anchored call, without
 * their group ids, which the new revision may not have. Nothing when that
 * revision listed none: the call then runs as a fresh one.
 */
export function renderPreviousProductDiff(
  previous: ProductDiff | undefined,
): string {
  if (previous === undefined || previous.changes.length === 0) {
    return "";
  }
  const rows = previous.changes.map(renderPreviousChange).join("\n");
  return `\n\n## Previous Product diff\n<pr_previous_product_diff>\n${rows}\n</pr_previous_product_diff>`;
}

function renderChangeGroupLine(group: ListedChangeGroup): string {
  const title = sanitizeUntrustedLine(group.title);
  const summary = sanitizeUntrustedLine(group.summary);
  // The id is model-written like the title: a brief call that read a hostile
  // PR could have put a fence tag in it.
  const id = sanitizeUntrustedLine(group.id);
  return `- ${id}: ${title}\n  ${summary}`;
}

/** The brief's change-groups as the call reads them: id, title and summary, never code. */
export function renderChangeGroups(
  groups: readonly ListedChangeGroup[],
): string {
  const lines = groups.map(renderChangeGroupLine).join("\n");
  return `<pr_change_groups>\n${lines || "(none)"}\n</pr_change_groups>`;
}
