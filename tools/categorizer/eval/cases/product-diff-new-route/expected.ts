import { BeforeSources } from "brief-core/types";
import type { EvalProperty } from "../../properties";
import {
  buildAvailableProperty,
  buildGroupIdsProperty,
  findProductChanges,
} from "../product-diff-props";

/**
 * acme/mergebrief#1035: a new `POST .../pulls/:prNumber/regenerate` route with two
 * new 409 wire codes and their copy, +576 -2 over 15 files. The route did not
 * exist before, so a row about it is new behaviour. The case asks for one
 * regenerate row sourced `did-not-exist`, with or without a before sentence,
 * and for none sourced `not-shown`. Every row property needs a listed
 * regenerate row, so an absent or empty section fails them. A call may fold
 * the route's refusals into one row.
 */
const REGENERATE_PATTERN = /regenerat/i;

export const properties: EvalProperty[] = [
  buildAvailableProperty(),
  {
    id: "regenerate-route-listed",
    description: "the new regenerate route is a listed Product change",
    check: (brief) => findProductChanges(brief, REGENERATE_PATTERN).length > 0,
  },
  {
    id: "regenerate-sourced-did-not-exist",
    description:
      "a regenerate row is sourced did-not-exist, whether or not it writes a before",
    check: (brief) =>
      findProductChanges(brief, REGENERATE_PATTERN).some(
        (change) => change.beforeSource === BeforeSources.DID_NOT_EXIST,
      ),
  },
  {
    id: "regenerate-rows-never-not-shown",
    description:
      "no regenerate row reads as not shown: a route that did not exist has no unknown before",
    check: (brief) => {
      const rows = findProductChanges(brief, REGENERATE_PATTERN);
      const hasUnknownBefore = rows.some(
        (change) => change.beforeSource === BeforeSources.NOT_SHOWN,
      );
      const listsOnlyKnownBefores = rows.length > 0 && !hasUnknownBefore;
      return listsOnlyKnownBefores;
    },
  },
  buildGroupIdsProperty(),
];
