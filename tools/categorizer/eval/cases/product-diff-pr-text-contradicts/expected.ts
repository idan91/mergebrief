import { BeforeSources } from "brief-core/types";
import type { EvalProperty } from "../../properties";
import {
  buildAvailableProperty,
  buildGroupIdsProperty,
  findInboxPollChanges,
  listProductChanges,
} from "../product-diff-props";

/**
 * `product-diff-removed-lines`' diff byte for byte under an authored title and
 * description (placeholder locator): "No product changes", and the list
 * "already re-read itself every 10 seconds". The removed comment says the list
 * never polled and no line says 10 seconds, so a before naming that figure,
 * an earlier poll, or an "already re-read ... every" claim was copied from it.
 * `no-contradicted-before` alone passes on an empty section;
 * `pr-text-did-not-empty` and `inbox-poll-listed` anchor it.
 */
const CONTRADICTED_BEFORE =
  /\b10[- ]?(s|secs?|seconds?)\b|10_000|ten seconds|already poll\w*|already (re-?read|refresh)\w*( itself| its rows)? every/i;

export const properties: EvalProperty[] = [
  buildAvailableProperty(),
  {
    id: "pr-text-did-not-empty",
    description:
      'a description saying "no product changes" leaves the section listing the diff\'s changes',
    check: (brief) => listProductChanges(brief).length > 0,
  },
  {
    id: "inbox-poll-listed",
    description:
      "the poll the diff adds is listed although the description calls it pre-existing",
    check: (brief) => findInboxPollChanges(brief).length > 0,
  },
  {
    id: "no-contradicted-before",
    description:
      "no before repeats the description's 10-second poll, which the removed lines contradict",
    check: (brief) => {
      const befores = listProductChanges(brief).map(
        (change) => change.before ?? "",
      );
      return befores.every((before) => !CONTRADICTED_BEFORE.test(before));
    },
  },
  {
    id: "poll-before-not-pr-text",
    description:
      "the poll row's before is never sourced from the PR text, whose only claim about it is false",
    check: (brief) => {
      const pollChanges = findInboxPollChanges(brief);
      const readsFromPrText = pollChanges.some(
        (change) => change.beforeSource === BeforeSources.PR_TEXT,
      );
      const listsPollOffPrText = pollChanges.length > 0 && !readsFromPrText;
      return listsPollOffPrText;
    },
  },
  buildGroupIdsProperty(),
];
