// The audited catalog, pinned as data: composing the app is what registers
// every operation, and this snapshot IS the audit list, reviewed here,
// emitted verbatim by the manifest generator. Each descriptor carries its
// router-stamped endpoint, so the snapshot is also the endpoint map, and its
// policy, so it is the reviewed record of what the router refuses.
import { ProductOperations } from "contract";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { productOperationRegistry } from "../src/product-operations/registry";
import { composeCatalog, type ComposedCatalog } from "./compose-catalog";

const EXPECTED_CATALOG = [
  {
    id: "address-risk",
    kind: "action",
    classification: "private-write",
    endpoint: "POST /api/repos/:repoId/pulls/:prNumber/session/risks/address",
    browserSessionOnly: true,
    requiresPushAccess: false,
    requiresInstallation: false,
    requiresStoredPullRequest: true,
  },
  {
    id: "archive-pull",
    kind: "action",
    classification: "private-write",
    endpoint: "PUT /api/repos/:repoId/pulls/:prNumber/archive",
    browserSessionOnly: false,
    requiresPushAccess: false,
    requiresInstallation: false,
    requiresStoredPullRequest: true,
  },
  {
    id: "create-draft-comment",
    kind: "action",
    classification: "private-write",
    endpoint: "POST /api/repos/:repoId/pulls/:prNumber/session/comments",
    browserSessionOnly: false,
    requiresPushAccess: false,
    requiresInstallation: false,
    requiresStoredPullRequest: true,
  },
  {
    id: "create-inline-comment",
    kind: "action",
    classification: "external-write",
    endpoint: "POST /api/repos/:repoId/pulls/:prNumber/comments",
    browserSessionOnly: false,
    requiresPushAccess: false,
    requiresInstallation: false,
    requiresStoredPullRequest: true,
  },
  {
    id: "delete-draft-comment",
    kind: "action",
    classification: "private-write",
    endpoint:
      "DELETE /api/repos/:repoId/pulls/:prNumber/session/comments/:draftId",
    browserSessionOnly: true,
    requiresPushAccess: false,
    requiresInstallation: false,
    requiresStoredPullRequest: true,
  },
  {
    id: "delete-own-pull",
    kind: "action",
    classification: "private-write",
    endpoint: "DELETE /api/inbox/:repoId/:prNumber",
    browserSessionOnly: true,
    requiresPushAccess: false,
    requiresInstallation: false,
    requiresStoredPullRequest: false,
  },
  {
    id: "delete-pull",
    kind: "action",
    classification: "private-write",
    endpoint: "DELETE /api/repos/:repoId/pulls/:prNumber",
    browserSessionOnly: true,
    requiresPushAccess: false,
    requiresInstallation: true,
    requiresStoredPullRequest: true,
  },
  {
    id: "dismiss-risk",
    kind: "action",
    classification: "private-write",
    endpoint: "POST /api/repos/:repoId/pulls/:prNumber/session/risks/dismiss",
    browserSessionOnly: true,
    requiresPushAccess: false,
    requiresInstallation: false,
    requiresStoredPullRequest: true,
  },
  {
    id: "dismiss-version-notice",
    kind: "action",
    classification: "private-write",
    endpoint: "POST /api/version/dismiss",
    browserSessionOnly: true,
    requiresPushAccess: false,
    requiresInstallation: false,
    requiresStoredPullRequest: false,
  },
  {
    id: "generate-brief",
    kind: "action",
    classification: "private-write",
    endpoint: "POST /api/generate",
    browserSessionOnly: false,
    requiresPushAccess: false,
    requiresInstallation: false,
    requiresStoredPullRequest: false,
  },
  {
    id: "list-collaborators",
    kind: "query",
    classification: "read",
    endpoint: "GET /api/repos/:repoId/collaborators",
    browserSessionOnly: false,
    requiresPushAccess: true,
    requiresInstallation: true,
    requiresStoredPullRequest: false,
  },
  {
    id: "list-inbox",
    kind: "query",
    classification: "read",
    endpoint: "GET /api/inbox",
    browserSessionOnly: false,
    requiresPushAccess: false,
    requiresInstallation: false,
    requiresStoredPullRequest: false,
  },
  {
    id: "list-local-briefs",
    kind: "query",
    classification: "read",
    endpoint: "GET /api/local-briefs",
    browserSessionOnly: false,
    requiresPushAccess: false,
    requiresInstallation: false,
    requiresStoredPullRequest: false,
  },
  {
    id: "list-repos",
    kind: "query",
    classification: "read",
    endpoint: "GET /api/repos",
    browserSessionOnly: false,
    requiresPushAccess: false,
    requiresInstallation: false,
    requiresStoredPullRequest: false,
  },
  {
    id: "list-tokens",
    kind: "query",
    classification: "read",
    endpoint: "GET /api/auth/tokens",
    browserSessionOnly: false,
    requiresPushAccess: false,
    requiresInstallation: false,
    requiresStoredPullRequest: false,
  },

  {
    id: "mark-ready",
    kind: "action",
    classification: "external-write",
    endpoint: "POST /api/repos/:repoId/pulls/:prNumber/ready",
    browserSessionOnly: false,
    requiresPushAccess: false,
    requiresInstallation: false,
    requiresStoredPullRequest: true,
  },
  {
    id: "mint-token",
    kind: "action",
    classification: "private-write",
    endpoint: "POST /api/auth/tokens",
    browserSessionOnly: false,
    requiresPushAccess: false,
    requiresInstallation: false,
    requiresStoredPullRequest: false,
  },
  {
    id: "purge-attachments",
    kind: "action",
    classification: "external-write",
    endpoint: "DELETE /api/repos/:repoId/attachments",
    browserSessionOnly: true,
    requiresPushAccess: false,
    requiresInstallation: true,
    requiresStoredPullRequest: false,
  },
  {
    id: "read-attachment",
    kind: "query",
    classification: "read",
    endpoint: "GET /api/repos/:repoId/pulls/:prNumber/attachments/:assetId",
    browserSessionOnly: false,
    requiresPushAccess: false,
    requiresInstallation: false,
    requiresStoredPullRequest: false,
  },
  {
    id: "read-brief",
    kind: "query",
    classification: "read",
    endpoint: "GET /api/repos/:repoId/pulls/:prNumber/brief",
    browserSessionOnly: false,
    requiresPushAccess: false,
    requiresInstallation: false,
    requiresStoredPullRequest: true,
  },
  {
    id: "read-brief-context",
    kind: "query",
    classification: "read",
    endpoint: "GET /api/repos/:repoId/pulls/:prNumber/brief-context",
    browserSessionOnly: false,
    requiresPushAccess: false,
    requiresInstallation: false,
    requiresStoredPullRequest: true,
  },
  {
    id: "read-capabilities",
    kind: "query",
    classification: "read",
    endpoint: "GET /api/capabilities",
    browserSessionOnly: false,
    requiresPushAccess: false,
    requiresInstallation: false,
    requiresStoredPullRequest: false,
  },
  {
    id: "read-conversation",
    kind: "query",
    classification: "read",
    endpoint: "GET /api/repos/:repoId/pulls/:prNumber/conversation",
    browserSessionOnly: false,
    requiresPushAccess: false,
    requiresInstallation: false,
    requiresStoredPullRequest: true,
  },
  {
    id: "read-delta",
    kind: "query",
    classification: "read",
    endpoint: "GET /api/repos/:repoId/pulls/:prNumber/delta",
    browserSessionOnly: false,
    requiresPushAccess: false,
    requiresInstallation: false,
    requiresStoredPullRequest: true,
  },
  {
    id: "read-diff",
    kind: "query",
    classification: "read",
    endpoint: "GET /api/repos/:repoId/pulls/:prNumber/diff",
    browserSessionOnly: false,
    requiresPushAccess: false,
    requiresInstallation: false,
    requiresStoredPullRequest: true,
  },
  {
    id: "read-file-range",
    kind: "query",
    classification: "read",
    endpoint: "GET /api/repos/:repoId/pulls/:prNumber/file-range",
    browserSessionOnly: false,
    requiresPushAccess: false,
    requiresInstallation: false,
    requiresStoredPullRequest: true,
  },
  {
    id: "read-local-brief",
    kind: "query",
    classification: "read",
    endpoint: "GET /api/local-briefs/:briefId",
    browserSessionOnly: false,
    requiresPushAccess: false,
    requiresInstallation: false,
    requiresStoredPullRequest: false,
  },
  {
    id: "read-local-brief-diffs",
    kind: "query",
    classification: "read",
    endpoint: "GET /api/local-briefs/:briefId/diffs",
    browserSessionOnly: false,
    requiresPushAccess: false,
    requiresInstallation: false,
    requiresStoredPullRequest: false,
  },
  {
    id: "read-local-comparison-marks",
    kind: "query",
    classification: "read",
    endpoint: "GET /api/local-briefs/:briefId/comparison-marks",
    browserSessionOnly: false,
    requiresPushAccess: false,
    requiresInstallation: false,
    requiresStoredPullRequest: false,
  },
  {
    id: "read-local-revision-narrative",
    kind: "query",
    classification: "read",
    endpoint: "GET /api/local-briefs/:briefId/revision-narrative",
    browserSessionOnly: false,
    requiresPushAccess: false,
    requiresInstallation: false,
    requiresStoredPullRequest: false,
  },
  {
    id: "read-marks",
    kind: "query",
    classification: "read",
    endpoint: "GET /api/repos/:repoId/pulls/:prNumber/marks",
    browserSessionOnly: false,
    requiresPushAccess: false,
    requiresInstallation: false,
    requiresStoredPullRequest: true,
  },
  {
    id: "read-narrative",
    kind: "query",
    classification: "read",
    endpoint: "GET /api/repos/:repoId/pulls/:prNumber/narrative",
    browserSessionOnly: false,
    requiresPushAccess: false,
    requiresInstallation: false,
    requiresStoredPullRequest: true,
  },
  {
    id: "read-pull",
    kind: "query",
    classification: "read",
    endpoint: "GET /api/repos/:repoId/pulls/:prNumber",
    browserSessionOnly: false,
    requiresPushAccess: false,
    requiresInstallation: false,
    requiresStoredPullRequest: true,
  },
  {
    id: "read-review-session",
    kind: "query",
    classification: "read",
    endpoint: "GET /api/repos/:repoId/pulls/:prNumber/session",
    browserSessionOnly: false,
    requiresPushAccess: false,
    requiresInstallation: false,
    requiresStoredPullRequest: true,
  },
  {
    id: "read-stack",
    kind: "query",
    classification: "read",
    endpoint: "GET /api/repos/:repoId/pulls/:prNumber/stack",
    browserSessionOnly: false,
    requiresPushAccess: false,
    requiresInstallation: false,
    requiresStoredPullRequest: true,
  },
  {
    id: "reanchor-draft-comment",
    kind: "action",
    classification: "private-write",
    endpoint:
      "PUT /api/repos/:repoId/pulls/:prNumber/session/comments/:draftId/anchor",
    browserSessionOnly: true,
    requiresPushAccess: false,
    requiresInstallation: false,
    requiresStoredPullRequest: true,
  },
  {
    id: "reclassify-group",
    kind: "action",
    classification: "private-write",
    endpoint:
      "PUT /api/repos/:repoId/pulls/:prNumber/session/groups/:groupId/classification",
    browserSessionOnly: false,
    requiresPushAccess: false,
    requiresInstallation: false,
    requiresStoredPullRequest: true,
  },
  {
    id: "reopen-risk",
    kind: "action",
    classification: "private-write",
    endpoint: "POST /api/repos/:repoId/pulls/:prNumber/session/risks/reopen",
    browserSessionOnly: true,
    requiresPushAccess: false,
    requiresInstallation: false,
    requiresStoredPullRequest: true,
  },
  {
    id: "reply-to-comment",
    kind: "action",
    classification: "external-write",
    endpoint:
      "POST /api/repos/:repoId/pulls/:prNumber/comments/:commentId/replies",
    browserSessionOnly: false,
    requiresPushAccess: false,
    requiresInstallation: false,
    requiresStoredPullRequest: true,
  },
  {
    id: "resolve-thread",
    kind: "action",
    classification: "external-write",
    endpoint:
      "POST /api/repos/:repoId/pulls/:prNumber/comments/:commentId/resolve",
    browserSessionOnly: false,
    requiresPushAccess: false,
    requiresInstallation: false,
    requiresStoredPullRequest: true,
  },
  {
    id: "revoke-sessions",
    kind: "action",
    classification: "private-write",
    endpoint: "DELETE /api/auth/sessions",
    browserSessionOnly: false,
    requiresPushAccess: false,
    requiresInstallation: false,
    requiresStoredPullRequest: false,
  },
  {
    id: "revoke-token",
    kind: "action",
    classification: "private-write",
    endpoint: "DELETE /api/auth/tokens/:id",
    browserSessionOnly: false,
    requiresPushAccess: false,
    requiresInstallation: false,
    requiresStoredPullRequest: false,
  },
  {
    id: "set-chunk-read",
    kind: "action",
    classification: "private-write",
    endpoint:
      "PUT /api/repos/:repoId/pulls/:prNumber/session/chunks/:chunkId/read",
    browserSessionOnly: false,
    requiresPushAccess: false,
    requiresInstallation: false,
    requiresStoredPullRequest: true,
  },
  {
    id: "set-review-outcome",
    kind: "action",
    classification: "private-write",
    endpoint: "PUT /api/repos/:repoId/pulls/:prNumber/session/outcome",
    browserSessionOnly: false,
    requiresPushAccess: false,
    requiresInstallation: false,
    requiresStoredPullRequest: true,
  },
  {
    id: "submit-review",
    kind: "action",
    classification: "external-write",
    endpoint: "POST /api/repos/:repoId/pulls/:prNumber/review",
    browserSessionOnly: false,
    requiresPushAccess: false,
    requiresInstallation: false,
    requiresStoredPullRequest: true,
  },
  {
    id: "unarchive-pull",
    kind: "action",
    classification: "private-write",
    endpoint: "DELETE /api/repos/:repoId/pulls/:prNumber/archive",
    browserSessionOnly: false,
    requiresPushAccess: false,
    requiresInstallation: false,
    requiresStoredPullRequest: true,
  },
  {
    id: "unresolve-thread",
    kind: "action",
    classification: "external-write",
    endpoint:
      "POST /api/repos/:repoId/pulls/:prNumber/comments/:commentId/unresolve",
    browserSessionOnly: false,
    requiresPushAccess: false,
    requiresInstallation: false,
    requiresStoredPullRequest: true,
  },
  {
    id: "update-draft-comment",
    kind: "action",
    classification: "private-write",
    endpoint:
      "PATCH /api/repos/:repoId/pulls/:prNumber/session/comments/:draftId",
    browserSessionOnly: false,
    requiresPushAccess: false,
    requiresInstallation: false,
    requiresStoredPullRequest: true,
  },
  {
    id: "upload-attachment",
    kind: "action",
    classification: "external-write",
    endpoint: "POST /api/repos/:repoId/pulls/:prNumber/attachments",
    browserSessionOnly: false,
    requiresPushAccess: false,
    requiresInstallation: true,
    requiresStoredPullRequest: false,
  },
] as const;

/** Endpoints that are deliberately not Product Operations (ADR 0039). */
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

  it("registers exactly the audited operations", () => {
    expect(productOperationRegistry.list()).toEqual(EXPECTED_CATALOG);
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
