// The catalog's id vocabulary. Declaration sites reference these constants
// instead of inline strings, and the router accepts ONLY the derived
// unions, so an id outside the vocabulary is a compile error and adding an
// operation starts here.
import type {
  AccessLevel,
  AccessLevels,
  HttpMethod,
  HttpMethods,
  ValueOf,
} from "types";

export const ProductQueryIds = {
  LIST_INBOX: "list-inbox",
  LIST_REPOS: "list-repos",
  LIST_TOKENS: "list-tokens",
  LIST_COLLABORATORS: "list-collaborators",
  SEARCH_MENTION_SUGGESTIONS: "search-mention-suggestions",
  RESOLVE_MENTION_TARGETS: "resolve-mention-targets",
  READ_CONVERSATION: "read-conversation",
  READ_PULL: "read-pull",
  READ_GENERATION_CLAIMS: "read-generation-claims",
  READ_SPEND: "read-spend",
  READ_BRIEF: "read-brief",
  READ_BRIEF_CONTEXT: "read-brief-context",
  READ_BRIEF_LAYOUT: "read-brief-layout",
  READ_MARKS: "read-marks",
  READ_DELTA: "read-delta",
  READ_NARRATIVE: "read-narrative",
  READ_DIFF: "read-diff",
  READ_REVIEW_SESSION: "read-review-session",
  READ_CAPABILITIES: "read-capabilities",
  READ_FILE_RANGE: "read-file-range",
  READ_STACK: "read-stack",
  READ_ATTACHMENT: "read-attachment",
  READ_COMMITTED_FILE: "read-committed-file",
  LIST_VIDEO_ASSETS: "list-video-assets",
  LIST_LOCAL_BRIEFS: "list-local-briefs",
  READ_LOCAL_BRIEF: "read-local-brief",
  READ_LOCAL_BRIEF_DIFFS: "read-local-brief-diffs",
  READ_LOCAL_COMPARISON_MARKS: "read-local-comparison-marks",
  READ_LOCAL_REVISION_NARRATIVE: "read-local-revision-narrative",
} as const;
export type ProductQueryId = ValueOf<typeof ProductQueryIds>;

export const ProductActionIds = {
  SUBMIT_REVIEW: "submit-review",
  MARK_READY: "mark-ready",
  REGENERATE_BRIEF: "regenerate-brief",
  CREATE_INLINE_COMMENT: "create-inline-comment",
  REPLY_TO_COMMENT: "reply-to-comment",
  RESOLVE_THREAD: "resolve-thread",
  UNRESOLVE_THREAD: "unresolve-thread",
  GENERATE_BRIEF: "generate-brief",
  DELETE_PULL: "delete-pull",
  DELETE_OWN_PULL: "delete-own-pull",
  ARCHIVE_PULL: "archive-pull",
  UNARCHIVE_PULL: "unarchive-pull",
  TURN_ON_GENERATE_EVERY_PUSH: "turn-on-generate-every-push",
  TURN_OFF_GENERATE_EVERY_PUSH: "turn-off-generate-every-push",
  MINT_TOKEN: "mint-token",
  REVOKE_TOKEN: "revoke-token",
  REVOKE_SESSIONS: "revoke-sessions",
  UPLOAD_ATTACHMENT: "upload-attachment",
  PURGE_ATTACHMENTS: "purge-attachments",
  // The Review Session writes. Declared here ahead of their routes because
  // the Attention List's `clearedBy` names them: the vocabulary is what a
  // client branches on, and an id it cannot resolve to a name is worse than
  // one whose endpoint lands a PR later.
  CREATE_DRAFT_COMMENT: "create-draft-comment",
  UPDATE_DRAFT_COMMENT: "update-draft-comment",
  REANCHOR_DRAFT_COMMENT: "reanchor-draft-comment",
  DELETE_DRAFT_COMMENT: "delete-draft-comment",
  MARK_CHUNK_READ: "mark-chunk-read",
  MARK_CHUNK_UNREAD: "mark-chunk-unread",
  RECLASSIFY_GROUP: "reclassify-group",
  DISMISS_RISK: "dismiss-risk",
  ADDRESS_RISK: "address-risk",
  REOPEN_RISK: "reopen-risk",
  SET_REVIEW_OUTCOME: "set-review-outcome",
  DISMISS_VERSION_NOTICE: "dismiss-version-notice",
} as const;
export type ProductActionId = ValueOf<typeof ProductActionIds>;

export type ProductOperationId = ProductQueryId | ProductActionId;

export const OperationKinds = {
  QUERY: "query",
  ACTION: "action",
} as const;
export type OperationKind = ValueOf<typeof OperationKinds>;

export type ActionHttpMethod = Exclude<HttpMethod, typeof HttpMethods.GET>;

export type ActionClassification = Exclude<
  AccessLevel,
  typeof AccessLevels.READ
>;

export interface ProductQueryRow {
  readonly kind: typeof OperationKinds.QUERY;
  readonly classification: typeof AccessLevels.READ;
  readonly method: typeof HttpMethods.GET;
  readonly path: string;
}

export interface ProductActionRow {
  readonly kind: typeof OperationKinds.ACTION;
  readonly classification: ActionClassification;
  readonly method: ActionHttpMethod;
  readonly path: string;
}

export type ProductOperationRow = ProductQueryRow | ProductActionRow;

export type ProductOperationTable = {
  readonly [Id in ProductQueryId]: ProductQueryRow;
} & {
  readonly [Id in ProductActionId]: ProductActionRow;
};
