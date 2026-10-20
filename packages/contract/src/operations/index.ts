import { AccessLevels, HttpMethods, type HttpMethod } from "types";
import {
  OperationKinds,
  ProductActionIds,
  ProductQueryIds,
  type ProductOperationId,
  type ProductOperationTable,
} from "./types";

// The one place an operation's full path is written; the api asserts every
// composed route against its row.
export const ProductOperations = {
  [ProductQueryIds.LIST_INBOX]: {
    kind: OperationKinds.QUERY,
    classification: AccessLevels.READ,
    method: HttpMethods.GET,
    path: "/api/inbox",
  },
  [ProductQueryIds.LIST_REPOS]: {
    kind: OperationKinds.QUERY,
    classification: AccessLevels.READ,
    method: HttpMethods.GET,
    path: "/api/repos",
  },
  [ProductQueryIds.LIST_TOKENS]: {
    kind: OperationKinds.QUERY,
    classification: AccessLevels.READ,
    method: HttpMethods.GET,
    path: "/api/auth/tokens",
  },
  [ProductQueryIds.LIST_COLLABORATORS]: {
    kind: OperationKinds.QUERY,
    classification: AccessLevels.READ,
    method: HttpMethods.GET,
    path: "/api/repos/:repoId/collaborators",
  },
  [ProductQueryIds.SEARCH_MENTION_SUGGESTIONS]: {
    kind: OperationKinds.QUERY,
    classification: AccessLevels.READ,
    method: HttpMethods.GET,
    path: "/api/repos/:repoId/mention-suggestions",
  },
  [ProductQueryIds.RESOLVE_MENTION_TARGETS]: {
    kind: OperationKinds.QUERY,
    classification: AccessLevels.READ,
    method: HttpMethods.GET,
    path: "/api/repos/:repoId/mention-targets",
  },
  [ProductQueryIds.READ_CONVERSATION]: {
    kind: OperationKinds.QUERY,
    classification: AccessLevels.READ,
    method: HttpMethods.GET,
    path: "/api/repos/:repoId/pulls/:prNumber/conversation",
  },
  [ProductQueryIds.READ_PULL]: {
    kind: OperationKinds.QUERY,
    classification: AccessLevels.READ,
    method: HttpMethods.GET,
    path: "/api/repos/:repoId/pulls/:prNumber",
  },
  [ProductQueryIds.READ_GENERATION_CLAIMS]: {
    kind: OperationKinds.QUERY,
    classification: AccessLevels.READ,
    method: HttpMethods.GET,
    path: "/api/repos/:repoId/pulls/:prNumber/generation",
  },
  [ProductQueryIds.READ_SPEND]: {
    kind: OperationKinds.QUERY,
    classification: AccessLevels.READ,
    method: HttpMethods.GET,
    path: "/api/spend",
  },
  [ProductQueryIds.READ_BRIEF]: {
    kind: OperationKinds.QUERY,
    classification: AccessLevels.READ,
    method: HttpMethods.GET,
    path: "/api/repos/:repoId/pulls/:prNumber/brief",
  },
  [ProductQueryIds.READ_BRIEF_CONTEXT]: {
    kind: OperationKinds.QUERY,
    classification: AccessLevels.READ,
    method: HttpMethods.GET,
    path: "/api/repos/:repoId/pulls/:prNumber/brief-context",
  },
  [ProductQueryIds.READ_MARKS]: {
    kind: OperationKinds.QUERY,
    classification: AccessLevels.READ,
    method: HttpMethods.GET,
    path: "/api/repos/:repoId/pulls/:prNumber/marks",
  },
  [ProductQueryIds.READ_DELTA]: {
    kind: OperationKinds.QUERY,
    classification: AccessLevels.READ,
    method: HttpMethods.GET,
    path: "/api/repos/:repoId/pulls/:prNumber/delta",
  },
  [ProductQueryIds.READ_NARRATIVE]: {
    kind: OperationKinds.QUERY,
    classification: AccessLevels.READ,
    method: HttpMethods.GET,
    path: "/api/repos/:repoId/pulls/:prNumber/narrative",
  },
  [ProductQueryIds.READ_DIFF]: {
    kind: OperationKinds.QUERY,
    classification: AccessLevels.READ,
    method: HttpMethods.GET,
    path: "/api/repos/:repoId/pulls/:prNumber/diff",
  },
  [ProductQueryIds.READ_REVIEW_SESSION]: {
    kind: OperationKinds.QUERY,
    classification: AccessLevels.READ,
    method: HttpMethods.GET,
    path: "/api/repos/:repoId/pulls/:prNumber/session",
  },
  [ProductQueryIds.READ_CAPABILITIES]: {
    kind: OperationKinds.QUERY,
    classification: AccessLevels.READ,
    method: HttpMethods.GET,
    path: "/api/capabilities",
  },
  [ProductQueryIds.READ_FILE_RANGE]: {
    kind: OperationKinds.QUERY,
    classification: AccessLevels.READ,
    method: HttpMethods.GET,
    path: "/api/repos/:repoId/pulls/:prNumber/file-range",
  },
  [ProductQueryIds.READ_STACK]: {
    kind: OperationKinds.QUERY,
    classification: AccessLevels.READ,
    method: HttpMethods.GET,
    path: "/api/repos/:repoId/pulls/:prNumber/stack",
  },
  [ProductQueryIds.READ_ATTACHMENT]: {
    kind: OperationKinds.QUERY,
    classification: AccessLevels.READ,
    method: HttpMethods.GET,
    path: "/api/repos/:repoId/pulls/:prNumber/attachments/:assetId",
  },
  [ProductQueryIds.LIST_LOCAL_BRIEFS]: {
    kind: OperationKinds.QUERY,
    classification: AccessLevels.READ,
    method: HttpMethods.GET,
    path: "/api/local-briefs",
  },
  [ProductQueryIds.READ_LOCAL_BRIEF]: {
    kind: OperationKinds.QUERY,
    classification: AccessLevels.READ,
    method: HttpMethods.GET,
    path: "/api/local-briefs/:briefId",
  },
  [ProductQueryIds.READ_LOCAL_BRIEF_DIFFS]: {
    kind: OperationKinds.QUERY,
    classification: AccessLevels.READ,
    method: HttpMethods.GET,
    path: "/api/local-briefs/:briefId/diffs",
  },
  [ProductQueryIds.READ_LOCAL_COMPARISON_MARKS]: {
    kind: OperationKinds.QUERY,
    classification: AccessLevels.READ,
    method: HttpMethods.GET,
    path: "/api/local-briefs/:briefId/comparison-marks",
  },
  [ProductQueryIds.READ_LOCAL_REVISION_NARRATIVE]: {
    kind: OperationKinds.QUERY,
    classification: AccessLevels.READ,
    method: HttpMethods.GET,
    path: "/api/local-briefs/:briefId/revision-narrative",
  },
  [ProductActionIds.SUBMIT_REVIEW]: {
    kind: OperationKinds.ACTION,
    classification: AccessLevels.EXTERNAL_WRITE,
    method: HttpMethods.POST,
    path: "/api/repos/:repoId/pulls/:prNumber/review",
  },
  [ProductActionIds.MARK_READY]: {
    kind: OperationKinds.ACTION,
    classification: AccessLevels.EXTERNAL_WRITE,
    method: HttpMethods.POST,
    path: "/api/repos/:repoId/pulls/:prNumber/ready",
  },
  [ProductActionIds.CREATE_INLINE_COMMENT]: {
    kind: OperationKinds.ACTION,
    classification: AccessLevels.EXTERNAL_WRITE,
    method: HttpMethods.POST,
    path: "/api/repos/:repoId/pulls/:prNumber/comments",
  },
  [ProductActionIds.REPLY_TO_COMMENT]: {
    kind: OperationKinds.ACTION,
    classification: AccessLevels.EXTERNAL_WRITE,
    method: HttpMethods.POST,
    path: "/api/repos/:repoId/pulls/:prNumber/comments/:commentId/replies",
  },
  [ProductActionIds.RESOLVE_THREAD]: {
    kind: OperationKinds.ACTION,
    classification: AccessLevels.EXTERNAL_WRITE,
    method: HttpMethods.POST,
    path: "/api/repos/:repoId/pulls/:prNumber/comments/:commentId/resolve",
  },
  [ProductActionIds.UNRESOLVE_THREAD]: {
    kind: OperationKinds.ACTION,
    classification: AccessLevels.EXTERNAL_WRITE,
    method: HttpMethods.POST,
    path: "/api/repos/:repoId/pulls/:prNumber/comments/:commentId/unresolve",
  },
  [ProductActionIds.GENERATE_BRIEF]: {
    kind: OperationKinds.ACTION,
    classification: AccessLevels.PRIVATE_WRITE,
    method: HttpMethods.POST,
    path: "/api/generate",
  },
  [ProductActionIds.DELETE_PULL]: {
    kind: OperationKinds.ACTION,
    classification: AccessLevels.PRIVATE_WRITE,
    method: HttpMethods.DELETE,
    path: "/api/repos/:repoId/pulls/:prNumber",
  },
  [ProductActionIds.DELETE_OWN_PULL]: {
    kind: OperationKinds.ACTION,
    classification: AccessLevels.PRIVATE_WRITE,
    method: HttpMethods.DELETE,
    path: "/api/inbox/:repoId/:prNumber",
  },
  [ProductActionIds.ARCHIVE_PULL]: {
    kind: OperationKinds.ACTION,
    classification: AccessLevels.PRIVATE_WRITE,
    method: HttpMethods.POST,
    path: "/api/repos/:repoId/pulls/:prNumber/archive",
  },
  [ProductActionIds.UNARCHIVE_PULL]: {
    kind: OperationKinds.ACTION,
    classification: AccessLevels.PRIVATE_WRITE,
    method: HttpMethods.POST,
    path: "/api/repos/:repoId/pulls/:prNumber/unarchive",
  },
  [ProductActionIds.MINT_TOKEN]: {
    kind: OperationKinds.ACTION,
    classification: AccessLevels.PRIVATE_WRITE,
    method: HttpMethods.POST,
    path: "/api/auth/tokens",
  },
  [ProductActionIds.REVOKE_TOKEN]: {
    kind: OperationKinds.ACTION,
    classification: AccessLevels.PRIVATE_WRITE,
    method: HttpMethods.DELETE,
    path: "/api/auth/tokens/:id",
  },
  [ProductActionIds.REVOKE_SESSIONS]: {
    kind: OperationKinds.ACTION,
    classification: AccessLevels.PRIVATE_WRITE,
    method: HttpMethods.DELETE,
    path: "/api/auth/sessions",
  },
  [ProductActionIds.UPLOAD_ATTACHMENT]: {
    kind: OperationKinds.ACTION,
    classification: AccessLevels.EXTERNAL_WRITE,
    method: HttpMethods.POST,
    path: "/api/repos/:repoId/pulls/:prNumber/attachments",
  },
  [ProductActionIds.PURGE_ATTACHMENTS]: {
    kind: OperationKinds.ACTION,
    classification: AccessLevels.EXTERNAL_WRITE,
    method: HttpMethods.DELETE,
    path: "/api/repos/:repoId/attachments",
  },
  [ProductActionIds.CREATE_DRAFT_COMMENT]: {
    kind: OperationKinds.ACTION,
    classification: AccessLevels.PRIVATE_WRITE,
    method: HttpMethods.POST,
    path: "/api/repos/:repoId/pulls/:prNumber/session/comments",
  },
  [ProductActionIds.UPDATE_DRAFT_COMMENT]: {
    kind: OperationKinds.ACTION,
    classification: AccessLevels.PRIVATE_WRITE,
    method: HttpMethods.PATCH,
    path: "/api/repos/:repoId/pulls/:prNumber/session/comments/:draftId",
  },
  [ProductActionIds.REANCHOR_DRAFT_COMMENT]: {
    kind: OperationKinds.ACTION,
    classification: AccessLevels.PRIVATE_WRITE,
    method: HttpMethods.PUT,
    path: "/api/repos/:repoId/pulls/:prNumber/session/comments/:draftId/anchor",
  },
  [ProductActionIds.DELETE_DRAFT_COMMENT]: {
    kind: OperationKinds.ACTION,
    classification: AccessLevels.PRIVATE_WRITE,
    method: HttpMethods.DELETE,
    path: "/api/repos/:repoId/pulls/:prNumber/session/comments/:draftId",
  },
  [ProductActionIds.MARK_CHUNK_READ]: {
    kind: OperationKinds.ACTION,
    classification: AccessLevels.PRIVATE_WRITE,
    method: HttpMethods.POST,
    path: "/api/repos/:repoId/pulls/:prNumber/session/chunks/:chunkId/read",
  },
  [ProductActionIds.MARK_CHUNK_UNREAD]: {
    kind: OperationKinds.ACTION,
    classification: AccessLevels.PRIVATE_WRITE,
    method: HttpMethods.POST,
    path: "/api/repos/:repoId/pulls/:prNumber/session/chunks/:chunkId/unread",
  },
  [ProductActionIds.RECLASSIFY_GROUP]: {
    kind: OperationKinds.ACTION,
    classification: AccessLevels.PRIVATE_WRITE,
    method: HttpMethods.PUT,
    path: "/api/repos/:repoId/pulls/:prNumber/session/groups/:groupId/classification",
  },
  [ProductActionIds.DISMISS_RISK]: {
    kind: OperationKinds.ACTION,
    classification: AccessLevels.PRIVATE_WRITE,
    method: HttpMethods.POST,
    path: "/api/repos/:repoId/pulls/:prNumber/session/risks/dismiss",
  },
  [ProductActionIds.ADDRESS_RISK]: {
    kind: OperationKinds.ACTION,
    classification: AccessLevels.PRIVATE_WRITE,
    method: HttpMethods.POST,
    path: "/api/repos/:repoId/pulls/:prNumber/session/risks/address",
  },
  [ProductActionIds.REOPEN_RISK]: {
    kind: OperationKinds.ACTION,
    classification: AccessLevels.PRIVATE_WRITE,
    method: HttpMethods.POST,
    path: "/api/repos/:repoId/pulls/:prNumber/session/risks/reopen",
  },
  [ProductActionIds.SET_REVIEW_OUTCOME]: {
    kind: OperationKinds.ACTION,
    classification: AccessLevels.PRIVATE_WRITE,
    method: HttpMethods.PUT,
    path: "/api/repos/:repoId/pulls/:prNumber/session/outcome",
  },
  [ProductActionIds.DISMISS_VERSION_NOTICE]: {
    kind: OperationKinds.ACTION,
    classification: AccessLevels.PRIVATE_WRITE,
    method: HttpMethods.POST,
    path: "/api/version/dismiss",
  },
} as const satisfies ProductOperationTable;

type ProductOperationRows = typeof ProductOperations;

export type ProductEndpoint = {
  readonly [Id in ProductOperationId]: `${ProductOperationRows[Id]["method"]} ${ProductOperationRows[Id]["path"]}`;
}[ProductOperationId];

export type RouteEndpoint = `${HttpMethod} ${string}`;

/** One rule for a row and a composed route, so the two compare. */
export function formatEndpoint(
  method: HttpMethod,
  path: string,
): RouteEndpoint {
  const endpoint: RouteEndpoint = `${method} ${path}`;
  return endpoint;
}

const PRODUCT_ENDPOINTS: ReadonlySet<RouteEndpoint> = new Set(
  Object.values(ProductOperations).map((row) =>
    formatEndpoint(row.method, row.path),
  ),
);

function isProductEndpoint(value: RouteEndpoint): value is ProductEndpoint {
  return PRODUCT_ENDPOINTS.has(value);
}

export function formatProductEndpoint(id: ProductOperationId): ProductEndpoint {
  const row = ProductOperations[id];
  const endpoint = formatEndpoint(row.method, row.path);
  // Narrows the string the table itself built, so it cannot fail.
  if (!isProductEndpoint(endpoint)) {
    throw new Error(`operation "${id}" formats outside the operation table`);
  }
  return endpoint;
}
