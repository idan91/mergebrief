import type { ValueOf } from "./utils";

/** The provisional submit verdict. */
export const ReviewOutcomes = {
  COMMENT: "comment",
  APPROVE: "approve",
  REQUEST_CHANGES: "request-changes",
} as const;
export type ReviewOutcome = ValueOf<typeof ReviewOutcomes>;

/**
 * The Change-group intent vocabulary a reviewer reclassifies to,
 * wire-identical to brief-core's `Categories`. Mirrored here (not imported)
 * so this package keeps zero dependencies; persistence's
 * `test/review-session.test.ts` pins the mirror against the source AND
 * against the DB CHECK, so all three move together.
 */
export const ChangeGroupCategories = {
  BUGFIX: "bugfix",
  LOGIC_REFACTOR: "logic-refactor",
  MOVE_WITH_EDITS: "move-with-edits",
  LIB_BUMP: "lib-bump",
  PURE_MOVE: "pure-move",
  NEW_FEATURE: "new-feature",
  DEPENDENCY_UPDATE: "dependency-update",
  SCHEMA_CHANGE: "schema-change",
} as const;
export type ChangeGroupCategory = ValueOf<typeof ChangeGroupCategories>;
