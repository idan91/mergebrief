// The catalog's id vocabulary. Declaration sites reference these constants
// instead of inline strings, and the router accepts ONLY the derived
// unions — an id outside the vocabulary is a compile error, so adding an
// operation starts here.
import type { ValueOf } from "types";

export const PRODUCT_QUERY_ID = {
  LIST_PULLS: "list-pulls",
  LIST_REPOS: "list-repos",
  LIST_INSTALLATIONS: "list-installations",
  LIST_TOKENS: "list-tokens",
  LIST_COLLABORATORS: "list-collaborators",
  READ_CONVERSATION: "read-conversation",
  READ_PULL: "read-pull",
  READ_BRIEF: "read-brief",
  READ_BRIEF_CONTEXT: "read-brief-context",
  READ_MARKS: "read-marks",
  READ_DELTA: "read-delta",
  READ_NARRATIVE: "read-narrative",
  READ_DIFF: "read-diff",
} as const;
export type ProductQueryId = ValueOf<typeof PRODUCT_QUERY_ID>;

export const PRODUCT_ACTION_ID = {
  SUBMIT_REVIEW: "submit-review",
  MARK_READY: "mark-ready",
  CREATE_INLINE_COMMENT: "create-inline-comment",
  REPLY_TO_COMMENT: "reply-to-comment",
  RESOLVE_THREAD: "resolve-thread",
  UNRESOLVE_THREAD: "unresolve-thread",
  GENERATE_BRIEF: "generate-brief",
  MINT_TOKEN: "mint-token",
  REVOKE_TOKEN: "revoke-token",
  SELECT_INSTALLATION: "select-installation",
} as const;
export type ProductActionId = ValueOf<typeof PRODUCT_ACTION_ID>;
