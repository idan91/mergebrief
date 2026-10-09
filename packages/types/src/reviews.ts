import type { ValueOf } from "./utils";

/** The provisional submit verdict. */
export const ReviewOutcomes = {
  COMMENT: "comment",
  APPROVE: "approve",
  REQUEST_CHANGES: "request-changes",
} as const;
export type ReviewOutcome = ValueOf<typeof ReviewOutcomes>;

/**
 * Category - the intent of a Change-group: what the model assigns at
 * generation and what a reviewer reclassifies to. Persistence's
 * `test/review-session.test.ts` pins it against the DB CHECK.
 */
export const ChangeGroupCategories = {
  BUGFIX: "bugfix", // correct a defect in existing behavior
  LOGIC_REFACTOR: "logic-refactor", // behavior-preserving restructure of logic
  MOVE_WITH_EDITS: "move-with-edits", // relocation of code with edits inside the move
  LIB_BUMP: "lib-bump", // dependency version change *with* API/behavior impact
  PURE_MOVE: "pure-move", // relocation only, bytes identical, no edits
  NEW_FEATURE: "new-feature", // adds a new capability
  DEPENDENCY_UPDATE: "dependency-update", // dep version bump with no API/behavior impact
  SCHEMA_CHANGE: "schema-change", // data-model / migration change
} as const;
export type ChangeGroupCategory = ValueOf<typeof ChangeGroupCategories>;
