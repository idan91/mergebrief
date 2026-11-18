// The catalog seam: registry semantics (invalid id / conflicting descriptor =
// programmer error = throw; identical re-registration = no-op) and the product
// router, declaration and mounting as one statement, endpoints stamped from
// the mount prefixes at the root commit.
import type { Env, Hono, MiddlewareHandler } from "hono";
import { AccessLevels, type AccessLevel } from "types";
import { describe, expect, it } from "vitest";
import { createProductOperationRegistry } from "../src/product-operations/registry";
import {
  OperationKinds,
  ProductActionIds,
  ProductOperations,
  ProductQueryIds,
  type ProductOperationId,
} from "contract";
import { productRouter } from "../src/product-operations/product-router";
import type { PullRequestEnv } from "../src/access/types";
import { OPEN_POLICY } from "./fixtures";

describe("product operation registry", () => {
  it("enumerates registered descriptors sorted by id", () => {
    const registry = createProductOperationRegistry();
    registry.register({
      id: "list-inbox",
      kind: OperationKinds.QUERY,
      classification: AccessLevels.READ,
      ...OPEN_POLICY,
      endpoint: "GET /api/inbox",
    });
    registry.register({
      id: "generate-brief",
      kind: OperationKinds.ACTION,
      classification: AccessLevels.PRIVATE_WRITE,
      ...OPEN_POLICY,
      endpoint: "POST /api/generate",
    });
    expect(registry.list().map((d) => d.id)).toEqual([
      "generate-brief",
      "list-inbox",
    ]);
  });

  it("returns descriptors with their full audited shape", () => {
    const registry = createProductOperationRegistry();
    registry.register({
      id: "mint-token",
      kind: OperationKinds.ACTION,
      classification: AccessLevels.PRIVATE_WRITE,
      ...OPEN_POLICY,
      endpoint: "POST /api/auth/tokens",
    });
    expect(registry.list()).toEqual([
      {
        id: "mint-token",
        kind: "action",
        classification: "private-write",
        ...OPEN_POLICY,
        endpoint: "POST /api/auth/tokens",
      },
    ]);
  });

  it("re-registering an identical descriptor is a no-op", () => {
    const registry = createProductOperationRegistry();
    const descriptor = {
      id: "list-inbox",
      kind: OperationKinds.QUERY,
      classification: AccessLevels.READ,
      ...OPEN_POLICY,
      endpoint: "GET /api/inbox",
    } as const;
    registry.register(descriptor);
    registry.register(descriptor);
    expect(registry.list()).toHaveLength(1);
  });

  it("throws when the same id re-registers with a different descriptor", () => {
    const registry = createProductOperationRegistry();
    const descriptor = {
      id: "list-inbox",
      kind: OperationKinds.QUERY,
      classification: AccessLevels.READ,
      ...OPEN_POLICY,
      endpoint: "GET /api/inbox",
    } as const;
    registry.register(descriptor);
    expect(() =>
      registry.register({ ...descriptor, endpoint: "GET /api/repos" }),
    ).toThrowError(/list-inbox/);
    expect(() =>
      registry.register({
        ...descriptor,
        kind: OperationKinds.ACTION,
        classification: AccessLevels.PRIVATE_WRITE,
        ...OPEN_POLICY,
      }),
    ).toThrowError(/list-inbox/);
  });

  it.each(["ListPulls", "list_pulls", "list pulls", "", "-lead", "trail-"])(
    "throws on a non-kebab-case id: %j",
    (id) => {
      const registry = createProductOperationRegistry();
      expect(() =>
        registry.register({
          id: id as ProductOperationId,
          kind: OperationKinds.QUERY,
          classification: AccessLevels.READ,
          ...OPEN_POLICY,
          endpoint: "GET /api/inbox",
        }),
      ).toThrowError(/kebab-case/);
    },
  );

  it("a listing is a snapshot, later registrations do not mutate it", () => {
    const registry = createProductOperationRegistry();
    registry.register({
      id: "read-pull",
      kind: OperationKinds.QUERY,
      classification: AccessLevels.READ,
      ...OPEN_POLICY,
      endpoint: "GET /api/repos/:repoId/pulls/:prNumber",
    });
    const snapshot = registry.list();
    registry.register({
      id: "read-brief",
      kind: OperationKinds.QUERY,
      classification: AccessLevels.READ,
      ...OPEN_POLICY,
      endpoint: "GET /api/repos/:repoId/pulls/:prNumber/brief",
    });
    expect(snapshot).toHaveLength(1);
  });
});

const QUERY = { id: ProductQueryIds.LIST_INBOX, ...OPEN_POLICY } as const;
const ACTION = { id: ProductActionIds.SUBMIT_REVIEW, ...OPEN_POLICY } as const;

const INBOX_PATH = ProductOperations[ProductQueryIds.LIST_INBOX].path;
const REVIEW_PATH = ProductOperations[ProductActionIds.SUBMIT_REVIEW].path;

/** What the auth middleware contributes, as far as the scope check cares. */
interface SessionEnv {
  Variables: { session: { scope: string } };
}

/** Stand in for the auth middleware: put a principal carrying `scope` in ctx. */
function scopeSetter(scope: AccessLevel): MiddlewareHandler<SessionEnv> {
  return async (c, next) => {
    c.set("session", { scope });
    await next();
  };
}

describe("product router", () => {
  it("action mounts each operation under its table row's method", async () => {
    const router = productRouter<SessionEnv>();
    router.use(scopeSetter(AccessLevels.EXTERNAL_WRITE));
    router.action(ACTION, "/review", (c) => c.json({ ok: true }));
    router.action(
      { id: ProductActionIds.REVOKE_TOKEN, ...OPEN_POLICY },
      "/tokens/:id",
      (c) => c.json({ id: c.req.param("id") }),
    );
    expect(
      (await router.app.request("/review", { method: "POST" })).status,
    ).toBe(200);
    const res = await router.app.request("/tokens/7", { method: "DELETE" });
    expect(await res.json()).toEqual({ id: "7" });
    // The wrong method for a declared path falls through to 404.
    expect((await router.app.request("/review")).status).toBe(404);
  });

  it("commit stamps full endpoints from the mount prefixes", () => {
    const registry = createProductOperationRegistry();
    const pr = productRouter();
    pr.query(
      { id: ProductQueryIds.READ_CONVERSATION, ...OPEN_POLICY },
      "/conversation",
      (c) => c.body(null, 204),
    );
    pr.action(ACTION, "/review", (c) => c.body(null, 204));
    const repos = productRouter();
    repos.query({ id: ProductQueryIds.LIST_REPOS, ...OPEN_POLICY }, "/", (c) =>
      c.body(null, 204),
    );
    repos.route("/:repoId/pulls/:prNumber", pr);
    const root = productRouter();
    root.route("/api", productRouterWrapping("/repos", repos));
    root.commit(registry);
    expect(registry.list().map((d) => d.endpoint)).toEqual([
      "GET /api/repos",
      "GET /api/repos/:repoId/pulls/:prNumber/conversation",
      "POST /api/repos/:repoId/pulls/:prNumber/review",
    ]);
  });

  it("stamped endpoints match the composed app's own route table", () => {
    const registry = createProductOperationRegistry();
    const inbox = productRouter();
    inbox.query(QUERY, "/", (c) => c.body(null, 204));
    const pr = productRouter();
    pr.action(ACTION, "/review", (c) => c.body(null, 204));
    const api = productRouter();
    api.route("/inbox", inbox);
    api.route("/repos/:repoId/pulls/:prNumber", pr);
    const root = productRouter();
    root.route("/api", api);
    root.commit(registry);
    const mounted = root.app.routes
      .filter((route) => route.method !== "ALL")
      .map((route) => `${route.method} ${route.path}`)
      .toSorted();
    expect(
      registry
        .list()
        .map((d) => d.endpoint)
        .toSorted(),
    ).toEqual(mounted);
  });

  it("committing two identical compositions into one registry is a no-op", () => {
    const registry = createProductOperationRegistry();
    for (let i = 0; i < 2; i += 1) {
      const root = productRouter();
      root.query(QUERY, INBOX_PATH, (c) => c.body(null, 204));
      root.commit(registry);
    }
    expect(registry.list()).toHaveLength(1);
  });

  it("the same id under a different policy conflicts at commit", () => {
    const registry = createProductOperationRegistry();
    const first = productRouter();
    first.query(QUERY, INBOX_PATH, (c) => c.body(null, 204));
    first.commit(registry);
    const second = productRouter();
    second.query({ ...QUERY, browserSessionOnly: true }, INBOX_PATH, (c) =>
      c.body(null, 204),
    );
    expect(() => second.commit(registry)).toThrowError(/list-inbox/);
  });

  it("takes each declaration's classification from the operation table", () => {
    const registry = createProductOperationRegistry();
    const root = productRouter();
    root.query(QUERY, INBOX_PATH, (c) => c.body(null, 204));
    root.action(ACTION, REVIEW_PATH, (c) => c.body(null, 204));
    root.commit(registry);
    expect(
      registry
        .list()
        .map((descriptor) => [descriptor.id, descriptor.classification]),
    ).toEqual([
      [
        ProductQueryIds.LIST_INBOX,
        ProductOperations[ProductQueryIds.LIST_INBOX].classification,
      ],
      [
        ProductActionIds.SUBMIT_REVIEW,
        ProductOperations[ProductActionIds.SUBMIT_REVIEW].classification,
      ],
    ]);
  });

  it("commit throws when a composed path differs from the table row", () => {
    const root = productRouter();
    root.query(QUERY, "/api/inbox-v2", (c) => c.body(null, 204));
    expect(() => root.commit(createProductOperationRegistry())).toThrowError(
      /"list-inbox" composes as "GET \/api\/inbox-v2" but its operation table row is "GET \/api\/inbox"/,
    );
  });

  it("an action registers under its table row's method", () => {
    const registry = createProductOperationRegistry();
    const root = productRouter();
    root.action(
      { id: ProductActionIds.REVOKE_TOKEN, ...OPEN_POLICY },
      "/api/auth/tokens/:id",
      (c) => c.body(null, 204),
    );
    root.commit(registry);
    expect(registry.list().map((descriptor) => descriptor.endpoint)).toEqual([
      "DELETE /api/auth/tokens/:id",
    ]);
  });

  it("commit registers nothing once a row mismatch throws", () => {
    const registry = createProductOperationRegistry();
    const root = productRouter();
    root.query(QUERY, ProductOperations[ProductQueryIds.LIST_INBOX].path, (c) =>
      c.body(null, 204),
    );
    root.action(ACTION, "/elsewhere", (c) => c.body(null, 204));
    expect(() => root.commit(registry)).toThrowError(/submit-review/);
    expect(registry.list()).toHaveLength(0);
  });

  it("rejects ids outside the vocabulary at compile time and at declaration", () => {
    const router = productRouter();
    expect(() =>
      router.query(
        // @ts-expect-error, a query id must come from ProductQueryIds
        { id: "not-in-the-vocabulary", ...OPEN_POLICY },
        "/probe",
        (c) => c.body(null, 204),
      ),
    ).toThrowError(/not-in-the-vocabulary/);
    expect(() =>
      router.action(
        // @ts-expect-error, an action id must come from ProductActionIds
        { id: ProductQueryIds.LIST_INBOX, ...OPEN_POLICY },
        "/probe",
        (c) => c.body(null, 204),
      ),
    ).toThrowError(/"list-inbox" has kind "query", not "action"/);
    expect(() =>
      router.query(
        // @ts-expect-error, a query id must come from ProductQueryIds
        { id: ProductActionIds.SUBMIT_REVIEW, ...OPEN_POLICY },
        "/probe",
        (c) => c.body(null, 204),
      ),
    ).toThrowError(/"submit-review" has kind "action", not "query"/);
    expect(router.app.routes).toEqual([]);
  });

  it("a mounted child is sealed, so late declarations throw", () => {
    const child = productRouter();
    child.query(QUERY, "/pulls", (c) => c.body(null, 204));
    const root = productRouter();
    root.route("/api", child);
    expect(() =>
      child.action(ACTION, "/review", (c) => c.body(null, 204)),
    ).toThrowError(/mounted/);
  });

  it("a mounted child is sealed, so late mounts and commits throw", () => {
    const child = productRouter();
    child.query(QUERY, "/pulls", (c) => c.body(null, 204));
    const root = productRouter();
    root.route("/api", child);
    // Both would otherwise vanish silently: a late grandchild never reaches
    // the composed root, and a child commit stamps prefix-less endpoints.
    const grandchild = productRouter();
    expect(() => child.route("/extra", grandchild)).toThrowError(/mounted/);
    expect(() => child.commit(createProductOperationRegistry())).toThrowError(
      /mounted/,
    );
  });

  it("a mounted child is sealed, so late middleware throws", () => {
    const child = productRouter();
    child.query(QUERY, "/pulls", (c) => c.body(null, 204));
    const root = productRouter();
    root.route("/api", child);
    // Hono copied the child's table at mount time, so late middleware would
    // apply to the child alone and never reach the composed app.
    expect(() =>
      child.use(async (_c, next) => {
        await next();
      }),
    ).toThrowError(/mounted/);
    expect(() =>
      child.use("*", async (_c, next) => {
        await next();
      }),
    ).toThrowError(/mounted/);
  });

  it("middleware declared before mounting applies in the composed app", async () => {
    const child = productRouter();
    child.use(async (c, next) => {
      await next();
      c.header("x-gate", "on");
    });
    child.query(QUERY, "/pulls", (c) => c.body(null, 204));
    const root = productRouter();
    root.route("/api", child);
    const res = await root.app.request("/api/pulls");
    expect(res.status).toBe(204);
    expect(res.headers.get("x-gate")).toBe("on");
  });

  it("a committed router is sealed, so later declarations throw", () => {
    const root = productRouter();
    root.query(QUERY, INBOX_PATH, (c) => c.body(null, 204));
    root.commit(createProductOperationRegistry());
    // Anything added now is served but never registered, silent drift.
    expect(() =>
      root.action(ACTION, "/review", (c) => c.body(null, 204)),
    ).toThrowError(/committed/);
    expect(() =>
      root.query(
        { id: ProductQueryIds.LIST_REPOS, ...OPEN_POLICY },
        "/repos",
        (c) => c.body(null, 204),
      ),
    ).toThrowError(/committed/);
    expect(() => root.route("/extra", productRouter())).toThrowError(
      /committed/,
    );
    expect(() =>
      root.use(async (_c, next) => {
        await next();
      }),
    ).toThrowError(/committed/);
  });

  it("mounting an already-mounted child throws", () => {
    const child = productRouter();
    child.query(QUERY, "/pulls", (c) => c.body(null, 204));
    const first = productRouter();
    first.route("/api", child);
    const second = productRouter();
    expect(() => second.route("/other", child)).toThrowError(/already mounted/);
  });

  it("mounting a committed router into a new parent throws", () => {
    const registry = createProductOperationRegistry();
    const child = productRouter();
    child.query(QUERY, INBOX_PATH, (c) => c.body(null, 204));
    child.commit(registry);
    const root = productRouter();
    // Otherwise its operations re-register under the new prefix.
    expect(() => root.route("/api", child)).toThrowError(/already committed/);
    expect(registry.list().map((descriptor) => descriptor.endpoint)).toEqual([
      "GET /api/inbox",
    ]);
  });

  it("a rejected mount leaves the parent unmutated", async () => {
    const child = productRouter();
    child.query(QUERY, "/pulls", (c) => c.body(null, 204));
    const first = productRouter();
    first.route("/api", child);
    const second = productRouter();
    expect(() => second.route("/api", child)).toThrowError(/already mounted/);
    expect(second.app.routes).toHaveLength(0);
    expect((await second.app.request("/api/pulls")).status).toBe(404);
    const registry = createProductOperationRegistry();
    second.commit(registry);
    expect(registry.list()).toHaveLength(0);
  });

  it("committing twice throws", () => {
    const registry = createProductOperationRegistry();
    const root = productRouter();
    root.query(QUERY, INBOX_PATH, (c) => c.body(null, 204));
    root.commit(registry);
    expect(() => root.commit(registry)).toThrowError(/committed/);
    expect(registry.list()).toHaveLength(1);
  });

  it.each(["api", "/api/", ""])(
    "rejects a malformed mount prefix: %j",
    (prefix) => {
      const root = productRouter();
      expect(() => root.route(prefix, productRouter())).toThrowError(
        /mount prefix/,
      );
    },
  );

  it("middleware applies ahead of declared handlers", async () => {
    const router = productRouter();
    router.use(async (c, next) => {
      c.header("x-probe", "on");
      await next();
    });
    router.query(QUERY, "/pulls", (c) => c.body(null, 204));
    const res = await router.app.request("/pulls");
    expect(res.headers.get("x-probe")).toBe("on");
  });

  it("a bare Hono mounts without registering anything", async () => {
    const { Hono } = await import("hono");
    const bare = new Hono();
    bare.get("/version", (c) => c.json({ version: "dev" }));
    const registry = createProductOperationRegistry();
    const root = productRouter();
    root.route("/api", bare);
    root.commit(registry);
    expect(registry.list()).toHaveLength(0);
    expect((await root.app.request("/api/version")).status).toBe(200);
  });
});

/** Wrap a child under one extra prefix, composition-index shorthand. */
function productRouterWrapping(
  prefix: string,
  child: ReturnType<typeof productRouter>,
) {
  const wrapper = productRouter();
  wrapper.route(prefix, child);
  return wrapper;
}

async function post<E extends Env>(
  app: Hono<E>,
  path: string,
): Promise<Response> {
  return app.request(path, { method: "POST" });
}

describe("the scope check at the router seam", () => {
  function actionApp(scope: AccessLevel | undefined) {
    const router = productRouter<SessionEnv>();
    if (scope !== undefined) {
      router.use(scopeSetter(scope));
    }
    router.action(ACTION, "/review", (c) => c.json({ ok: true }));
    router.action(
      { id: ProductActionIds.GENERATE_BRIEF, ...OPEN_POLICY },
      "/generate",
      (c) => c.json({ ok: true }),
    );
    router.query(QUERY, "/pulls", (c) => c.json({ ok: true }));
    return router.app;
  }

  it("refuses a read-scoped credential on either write class", async () => {
    const app = actionApp(AccessLevels.READ);
    for (const path of ["/generate", "/review"]) {
      const res = await post(app, path);
      expect(res.status).toBe(403);
      expect(await res.json()).toMatchObject({ code: "scope-exceeded" });
    }
  });

  it("lets a read-scoped credential read", async () => {
    const res = await actionApp(AccessLevels.READ).request("/pulls");
    expect(res.status).toBe(200);
  });

  it("stops a private-write credential at the instance boundary", async () => {
    const app = actionApp(AccessLevels.PRIVATE_WRITE);
    expect((await post(app, "/generate")).status).toBe(200);
    const external = await post(app, "/review");
    expect(external.status).toBe(403);
    expect(await external.json()).toMatchObject({ code: "scope-exceeded" });
  });

  it("lets an external-write credential through everywhere", async () => {
    const app = actionApp(AccessLevels.EXTERNAL_WRITE);
    expect((await post(app, "/generate")).status).toBe(200);
    expect((await post(app, "/review")).status).toBe(200);
  });

  it("fails closed when no principal reached the handler", async () => {
    const res = await post(actionApp(undefined), "/review");
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ code: "unauthorized" });
  });

  it("fails closed on a principal whose scope is not the vocabulary", async () => {
    const router = productRouter<SessionEnv>();
    router.use(async (c, next) => {
      c.set("session", { scope: "admin" });
      await next();
    });
    router.action(ACTION, "/review", (c) => c.json({ ok: true }));
    expect((await post(router.app, "/review")).status).toBe(401);
  });
});

interface ChannelEnv {
  Variables: { session: { scope: string; channel: string } };
}

describe("the row step at the router seam", () => {
  function rowApp(channel: string, calls: string[], withLoader = true) {
    const router = productRouter<ChannelEnv>();
    router.use(async (c, next) => {
      c.set("session", {
        scope: AccessLevels.EXTERNAL_WRITE,
        channel,
      });
      if (withLoader) {
        c.set("loadOperationRow", async () => {
          calls.push("row");
        });
      }
      await next();
    });
    router.action(
      {
        id: ProductActionIds.DELETE_PULL,
        ...OPEN_POLICY,
        browserSessionOnly: true,
        requiresStoredPullRequest: true,
      },
      "/delete",
      (c) => {
        calls.push("handler");
        return c.json({ ok: true });
      },
    );
    return router.app;
  }

  it("loads the row after the policy checks and before the handler", async () => {
    const calls: string[] = [];

    const res = await rowApp("cookie", calls).request("/delete", {
      method: "DELETE",
    });

    expect(res.status).toBe(200);
    expect(calls).toEqual(["row", "handler"]);
  });

  it("never loads the row for an operation the policy refused", async () => {
    const calls: string[] = [];

    const res = await rowApp("bearer", calls).request("/delete", {
      method: "DELETE",
    });

    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "human-only" });
    expect(calls).toEqual([]);
  });

  it("throws when requiresStoredPullRequest has no row loader", async () => {
    const calls: string[] = [];

    const sent = rowApp("cookie", calls, false).request("/delete", {
      method: "DELETE",
    });

    await expect(sent).rejects.toThrow(/without a row loader/);
    expect(calls).toEqual([]);
  });

  it("admits requiresStoredPullRequest only where the env carries the row", () => {
    const router = productRouter<PullRequestEnv>();

    router.query(
      {
        id: ProductQueryIds.READ_PULL,
        ...OPEN_POLICY,
        requiresStoredPullRequest: true,
      },
      "/meta",
      (c) => c.json({ prNumber: c.get("pullRequestAccess").prNumber }),
    );
    router.query(
      // @ts-expect-error a handler reading the row cannot mount without one
      { id: ProductQueryIds.READ_ATTACHMENT, ...OPEN_POLICY },
      "/attachment",
      (c) => c.json({}),
    );

    expect(router.app.routes.map((route) => route.path)).toEqual([
      "/meta",
      "/attachment",
    ]);
  });
});
