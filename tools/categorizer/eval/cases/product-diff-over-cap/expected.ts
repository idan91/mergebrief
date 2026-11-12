import { MAX_PRODUCT_CHANGES, type ProductChange } from "brief-core/types";
import type { EvalProperty } from "../../properties";
import {
  buildAvailableProperty,
  buildGroupIdsProperty,
  isProductDiffAvailable,
  listProductChanges,
} from "../product-diff-props";

/**
 * code-review#1249: the CLI's `session`, `context`, `groups` and `diff` read
 * the latest finished revision when no span flag is given, `--revision <n>`
 * names an earlier one, exit codes and stderr lines change, and a per-PR read
 * record lands in the cache folder: 58 hunks, one call, at least ten Product
 * changes. The call lists every change and the pipeline cuts to eight, so
 * `at-most-eight` is a trim guarantee and `has-more-set` fails when the call
 * folds the PR into eight rows or fewer. It and the two headline rows fail on
 * an absent or unavailable section.
 */
const LATEST_PATTERN = /\b(latest|newest|most recent)\b/i;
const REVISION_FLAG_PATTERN = /--revision/i;
/**
 * The flag named as one a read leaves out. A condition that covers two reads,
 * "no-flag or `--revision`" or "no span flags or with `--revision`", passes
 * the flag in one of them, so it is not one.
 */
const LEFT_OUT_REVISION_FLAG =
  /\b(no(?!-)|none|neither|without|omit\w*)\b(?:(?!\bor with\b)[^.])*--revision/i;
/**
 * A read that names no span, said by what it leaves out: outright, as "no"
 * before the flag, or as the PR number alone. A default row that names no
 * such thing is not found.
 */
const NO_SPAN_CONDITION =
  /\b(without|omit\w*|bare|default|none|neither)\b|\bno\b[^.]*(\b(flag|span|revision)|\bshas?\b|--base|--head)|\b(only|just) (the |a )?(PR|pull request) number\b/i;

/** A row whose condition passes `--revision`, or whose outcome says what the flag does. */
function isRevisionFlagChange(change: ProductChange): boolean {
  const namesFlag = REVISION_FLAG_PATTERN.test(
    `${change.when} ${change.after}`,
  );
  const leavesFlagOut = LEFT_OUT_REVISION_FLAG.test(change.when);
  const isFlagRow = namesFlag && !leavesFlagOut;
  return isFlagRow;
}

function isDefaultReadChange(change: ProductChange): boolean {
  const passesFlag = REVISION_FLAG_PATTERN.test(change.when);
  const leavesFlagOut = LEFT_OUT_REVISION_FLAG.test(change.when);
  const isFlagRow = passesFlag && !leavesFlagOut;

  const isNoSpanRead = NO_SPAN_CONDITION.test(change.when);
  const namesLatest = LATEST_PATTERN.test(`${change.when} ${change.after}`);
  const isDefaultRow = !isFlagRow && isNoSpanRead && namesLatest;
  return isDefaultRow;
}

export const properties: EvalProperty[] = [
  buildAvailableProperty(),
  {
    id: "at-most-eight",
    description: `the section lists at most ${MAX_PRODUCT_CHANGES} changes`,
    check: (brief) => {
      const isWithinCap =
        listProductChanges(brief).length <= MAX_PRODUCT_CHANGES;
      const isReadWithinCap = isProductDiffAvailable(brief) && isWithinCap;
      return isReadWithinCap;
    },
  },
  {
    id: "has-more-set",
    description:
      "a PR with more Product changes than the cap sets hasMore on the section",
    check: (brief) => {
      const claimsMore = brief.productDiff?.hasMore === true;
      const isReadWithMore = isProductDiffAvailable(brief) && claimsMore;
      return isReadWithMore;
    },
  },
  {
    id: "latest-revision-default-listed",
    description:
      "a read with no span flag serving the latest revision is a listed Product change",
    check: (brief) => listProductChanges(brief).some(isDefaultReadChange),
  },
  {
    id: "revision-flag-listed",
    description: "the new `--revision <n>` flag is a listed Product change",
    check: (brief) => listProductChanges(brief).some(isRevisionFlagChange),
  },
  buildGroupIdsProperty(),
];
