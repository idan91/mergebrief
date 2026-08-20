// The audited catalog, pinned as data: composing the app is what registers
// every operation, and this snapshot IS the audit list — reviewed here,
// emitted verbatim by the manifest generator. Each descriptor carries its
// router-stamped endpoint, so the snapshot is also the endpoint map.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { productOperationRegistry } from "../src/product-operations/registry";
import { composeCatalog, type ComposedCatalog } from "./compose-catalog";

const EXPECTED_CATALOG = [
  {
    id: "create-inline-comment",
    kind: "action",
    classification: "external-write",
    endpoint: "POST /api/repos/:repoId/pulls/:prNumber/comments",
  },
  {
    id: "generate-brief",
    kind: "action",
    classification: "private-write",
    endpoint: "POST /api/generate",
  },
  {
    id: "list-collaborators",
    kind: "query",
    classification: "read",
    endpoint: "GET /api/repos/:repoId/collaborators",
  },
  {
    id: "list-installations",
    kind: "query",
    classification: "read",
    endpoint: "GET /api/auth/installations",
  },
  {
    id: "list-pulls",
    kind: "query",
    classification: "read",
    endpoint: "GET /api/pulls",
  },
  {
    id: "list-repos",
    kind: "query",
    classification: "read",
    endpoint: "GET /api/repos",
  },
  {
    id: "list-tokens",
    kind: "query",
    classification: "read",
    endpoint: "GET /api/auth/tokens",
  },
  {
    id: "mark-ready",
    kind: "action",
    classification: "external-write",
    endpoint: "POST /api/repos/:repoId/pulls/:prNumber/ready",
  },
  {
    id: "mint-token",
    kind: "action",
    classification: "private-write",
    endpoint: "POST /api/auth/tokens",
  },
  {
    id: "read-brief",
    kind: "query",
    classification: "read",
    endpoint: "GET /api/repos/:repoId/pulls/:prNumber/brief",
  },
  {
    id: "read-brief-context",
    kind: "query",
    classification: "read",
    endpoint: "GET /api/repos/:repoId/pulls/:prNumber/brief-context",
  },
  {
    id: "read-conversation",
    kind: "query",
    classification: "read",
    endpoint: "GET /api/repos/:repoId/pulls/:prNumber/conversation",
  },
  {
    id: "read-delta",
    kind: "query",
    classification: "read",
    endpoint: "GET /api/repos/:repoId/pulls/:prNumber/delta",
  },
  {
    id: "read-diff",
    kind: "query",
    classification: "read",
    endpoint: "GET /api/repos/:repoId/pulls/:prNumber/diff",
  },
  {
    id: "read-marks",
    kind: "query",
    classification: "read",
    endpoint: "GET /api/repos/:repoId/pulls/:prNumber/marks",
  },
  {
    id: "read-narrative",
    kind: "query",
    classification: "read",
    endpoint: "GET /api/repos/:repoId/pulls/:prNumber/narrative",
  },
  {
    id: "read-pull",
    kind: "query",
    classification: "read",
    endpoint: "GET /api/repos/:repoId/pulls/:prNumber",
  },
  {
    id: "read-review-session",
    kind: "query",
    classification: "read",
    endpoint: "GET /api/repos/:repoId/pulls/:prNumber/session",
  },
  {
    id: "reply-to-comment",
    kind: "action",
    classification: "external-write",
    endpoint:
      "POST /api/repos/:repoId/pulls/:prNumber/comments/:commentId/replies",
  },
  {
    id: "resolve-thread",
    kind: "action",
    classification: "external-write",
    endpoint:
      "POST /api/repos/:repoId/pulls/:prNumber/comments/:commentId/resolve",
  },
  {
    id: "revoke-token",
    kind: "action",
    classification: "private-write",
    endpoint: "DELETE /api/auth/tokens/:id",
  },
  {
    id: "select-installation",
    kind: "action",
    classification: "private-write",
    endpoint: "POST /api/auth/installations",
  },
  {
    id: "submit-review",
    kind: "action",
    classification: "external-write",
    endpoint: "POST /api/repos/:repoId/pulls/:prNumber/review",
  },
  {
    id: "unresolve-thread",
    kind: "action",
    classification: "external-write",
    endpoint:
      "POST /api/repos/:repoId/pulls/:prNumber/comments/:commentId/unresolve",
  },
] as const;

/** Endpoints that are deliberately not Product Operations (ADR 0039). */
const EXEMPT_ENDPOINTS = new Set([
  "GET /api/auth/github",
  "GET /api/auth/github/callback",
  "POST /api/auth/logout",
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

  it("every non-exempt endpoint is registered — the derived backstop", () => {
    const mounted = composed.app.routes
      .filter((route) => route.method !== "ALL")
      .map((route) => `${route.method} ${route.path}`)
      .filter((endpoint) => !EXEMPT_ENDPOINTS.has(endpoint));
    // The mounted surface (minus the ADR-listed exempt set) must equal the
    // registry's stamped endpoints EXACTLY — an unregistered route or a
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
