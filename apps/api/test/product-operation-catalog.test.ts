// The composed catalog: composing the app is what registers every
// operation. The registry must match the operation table row for row, every
// mounted endpoint must be registered, and each operation's policy is pinned
// here as the reviewed record of what the router refuses.
import {
  ProductActionIds,
  ProductOperations,
  ProductQueryIds,
  type ProductOperationId,
} from "contract";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  expectTypeOf,
  it,
} from "vitest";
import { productOperationRegistry } from "../src/product-operations/registry";
import type {
  OperationPolicy,
  ProductOperationDescriptor,
} from "../src/product-operations/types";
import { composeCatalog, type ComposedCatalog } from "./compose-catalog";

type PolicyFlag = keyof OperationPolicy;

const POLICY_FLAGS = [
  "browserSessionOnly",
  "requiresOperator",
  "requiresPushAccess",
  "requiresInstallation",
  "requiresStoredPullRequest",
] as const satisfies readonly PolicyFlag[];

function readPolicyFlags(
  descriptor: ProductOperationDescriptor,
): readonly PolicyFlag[] {
  return POLICY_FLAGS.filter((flag) => descriptor[flag]);
}

// The policy every operation declares, by id: only the flags it sets. The
// table holds kind, classification and path; this pins who may call it.
const EXPECTED_POLICY = {
  [ProductActionIds.ADDRESS_RISK]: [
    "browserSessionOnly",
    "requiresStoredPullRequest",
  ],
  [ProductActionIds.ARCHIVE_PULL]: ["requiresStoredPullRequest"],
  [ProductActionIds.CREATE_DRAFT_COMMENT]: ["requiresStoredPullRequest"],
  [ProductActionIds.CREATE_INLINE_COMMENT]: ["requiresStoredPullRequest"],
  [ProductActionIds.DELETE_DRAFT_COMMENT]: [
    "browserSessionOnly",
    "requiresStoredPullRequest",
  ],
  [ProductActionIds.DELETE_OWN_PULL]: ["browserSessionOnly"],
  [ProductActionIds.DELETE_PULL]: [
    "browserSessionOnly",
    "requiresInstallation",
    "requiresStoredPullRequest",
  ],
  [ProductActionIds.DISMISS_RISK]: [
    "browserSessionOnly",
    "requiresStoredPullRequest",
  ],
  [ProductActionIds.DISMISS_VERSION_NOTICE]: ["browserSessionOnly"],
  [ProductActionIds.GENERATE_BRIEF]: [],
  [ProductQueryIds.LIST_COLLABORATORS]: [
    "requiresPushAccess",
    "requiresInstallation",
  ],
  [ProductQueryIds.LIST_INBOX]: [],
  [ProductQueryIds.LIST_LOCAL_BRIEFS]: [],
  [ProductQueryIds.LIST_REPOS]: [],
  [ProductQueryIds.LIST_TOKENS]: [],
  [ProductActionIds.MARK_CHUNK_READ]: ["requiresStoredPullRequest"],
  [ProductActionIds.MARK_CHUNK_UNREAD]: ["requiresStoredPullRequest"],
  [ProductActionIds.MARK_READY]: ["requiresStoredPullRequest"],
  [ProductActionIds.MINT_TOKEN]: [],
  [ProductActionIds.PURGE_ATTACHMENTS]: [
    "browserSessionOnly",
    "requiresInstallation",
  ],
  [ProductQueryIds.READ_ATTACHMENT]: [],
  [ProductQueryIds.READ_COMMITTED_FILE]: [],
  [ProductQueryIds.LIST_VIDEO_ASSETS]: [],
  [ProductQueryIds.READ_BRIEF]: ["requiresStoredPullRequest"],
  [ProductQueryIds.READ_BRIEF_CONTEXT]: ["requiresStoredPullRequest"],
  [ProductQueryIds.READ_BRIEF_LAYOUT]: ["requiresStoredPullRequest"],
  [ProductQueryIds.READ_CAPABILITIES]: [],
  [ProductQueryIds.READ_CONVERSATION]: ["requiresStoredPullRequest"],
  [ProductQueryIds.READ_DELTA]: ["requiresStoredPullRequest"],
  [ProductQueryIds.READ_DIFF]: ["requiresStoredPullRequest"],
  [ProductQueryIds.READ_FILE_RANGE]: ["requiresStoredPullRequest"],
  [ProductQueryIds.READ_GENERATION_CLAIMS]: ["requiresStoredPullRequest"],
  [ProductQueryIds.READ_LOCAL_BRIEF]: [],
  [ProductQueryIds.READ_LOCAL_BRIEF_DIFFS]: [],
  [ProductQueryIds.READ_LOCAL_COMPARISON_MARKS]: [],
  [ProductQueryIds.READ_LOCAL_REVISION_NARRATIVE]: [],
  [ProductQueryIds.READ_MARKS]: ["requiresStoredPullRequest"],
  [ProductQueryIds.READ_NARRATIVE]: ["requiresStoredPullRequest"],
  [ProductQueryIds.READ_PULL]: ["requiresStoredPullRequest"],
  [ProductQueryIds.READ_REVIEW_SESSION]: ["requiresStoredPullRequest"],
  [ProductQueryIds.READ_SPEND]: ["requiresOperator"],
  [ProductQueryIds.READ_STACK]: ["requiresStoredPullRequest"],
  [ProductQueryIds.RESOLVE_MENTION_TARGETS]: [],
  [ProductQueryIds.SEARCH_MENTION_SUGGESTIONS]: [],
  [ProductActionIds.REANCHOR_DRAFT_COMMENT]: [
    "browserSessionOnly",
    "requiresStoredPullRequest",
  ],
  [ProductActionIds.RECLASSIFY_GROUP]: ["requiresStoredPullRequest"],
  [ProductActionIds.REGENERATE_BRIEF]: [
    "requiresPushAccess",
    "requiresInstallation",
    "requiresStoredPullRequest",
  ],
  [ProductActionIds.REOPEN_RISK]: [
    "browserSessionOnly",
    "requiresStoredPullRequest",
  ],
  [ProductActionIds.REPLY_TO_COMMENT]: ["requiresStoredPullRequest"],
  [ProductActionIds.RESOLVE_THREAD]: ["requiresStoredPullRequest"],
  [ProductActionIds.REVOKE_SESSIONS]: [],
  [ProductActionIds.REVOKE_TOKEN]: [],
  [ProductActionIds.SET_REVIEW_OUTCOME]: ["requiresStoredPullRequest"],
  [ProductActionIds.SUBMIT_REVIEW]: ["requiresStoredPullRequest"],
  [ProductActionIds.UNARCHIVE_PULL]: ["requiresStoredPullRequest"],
  [ProductActionIds.UNRESOLVE_THREAD]: ["requiresStoredPullRequest"],
  [ProductActionIds.UPDATE_DRAFT_COMMENT]: ["requiresStoredPullRequest"],
  [ProductActionIds.UPLOAD_ATTACHMENT]: ["requiresInstallation"],
} as const satisfies Record<ProductOperationId, readonly PolicyFlag[]>;

/** Endpoints that are deliberately not Product Operations. */
const EXEMPT_ENDPOINTS = new Set([
  "GET /api/auth/github",
  "GET /api/auth/github/callback",
  "POST /api/auth/logout",
  "GET /api/auth/session",
  "GET /api/version",
  "POST /api/webhooks/github",
]);

describe("product operation catalog", () => {
  let composed: ComposedCatalog;
  beforeAll(async () => {
    composed = await composeCatalog();
  });
  afterAll(async () => {
    await composed.harness.close();
  });

  it("lists every policy flag the router declares", () => {
    expectTypeOf<
      Exclude<PolicyFlag, (typeof POLICY_FLAGS)[number]>
    >().toEqualTypeOf<never>();
  });

  it("registers every operation with its pinned policy", () => {
    const registered = Object.fromEntries(
      productOperationRegistry
        .list()
        .map((descriptor) => [descriptor.id, readPolicyFlags(descriptor)]),
    );

    expect(registered).toEqual(EXPECTED_POLICY);
  });

  it("registers every operation table row at the row's own endpoint", () => {
    const registered = Object.fromEntries(
      productOperationRegistry
        .list()
        .map((descriptor) => [descriptor.id, descriptor.endpoint]),
    );
    const fromTable = Object.fromEntries(
      Object.entries(ProductOperations).map(([id, row]) => [
        id,
        `${row.method} ${row.path}`,
      ]),
    );
    expect(registered).toEqual(fromTable);
  });

  it("every non-exempt endpoint is registered: the derived backstop", () => {
    const mounted = composed.app.routes
      .filter((route) => route.method !== "ALL")
      .map((route) => `${route.method} ${route.path}`)
      .filter((endpoint) => !EXEMPT_ENDPOINTS.has(endpoint));
    // The mounted surface (minus the ADR-listed exempt set) must equal the
    // registry's stamped endpoints EXACTLY: an unregistered route or a
    // stamped path that drifts from the real mount both fail here.
    expect(new Set(mounted).size).toBe(mounted.length);
    expect(mounted.toSorted()).toEqual(
      productOperationRegistry
        .list()
        .map((d) => d.endpoint)
        .toSorted(),
    );
  });
});
