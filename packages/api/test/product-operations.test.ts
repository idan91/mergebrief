// The catalog seam: registry semantics (invalid id / conflicting descriptor =
// programmer error = throw; identical re-registration = no-op) and the product
// router — declaration and mounting as one statement, endpoints stamped from
// the mount prefixes at the root commit.
import type { Env, Hono, MiddlewareHandler } from "hono";
import type { WriteClassification } from "persistence";
import { describe, expect, it } from "vitest";
import { createProductOperationRegistry } from "../src/product-operations/registry";
import {
  ProductActionIds,
  ProductQueryIds,
} from "../src/product-operations/ids";
import { productRouter } from "../src/product-operations/product-router";
import {
  OPERATION_KIND,
  WRITE_CLASSIFICATION,
} from "../src/product-operations/types";

describe("product operation registry", () => {
  it("enumerates registered descriptors sorted by id", () => {
    const registry = createProductOperationRegistry();
    registry.register({
      id: "list-pulls",
      kind: OPERATION_KIND.QUERY,
      classification: WRITE_CLASSIFICATION.READ,
      endpoint: "GET /api/pulls",
    });
    registry.register({
      id: "generate-brief",
      kind: OPERATION_KIND.ACTION,
      classification: WRITE_CLASSIFICATION.PRIVATE_WRITE,
      endpoint: "POST /api/generate",
    });
    expect(registry.list().map((d) => d.id)).toEqual([
      "generate-brief",
      "list-pulls",
    ]);
  });

  it("returns descriptors with their full audited shape", () => {
    const registry = createProductOperationRegistry();
    registry.register({
      id: "mint-token",
      kind: OPERATION_KIND.ACTION,
      classification: WRITE_CLASSIFICATION.PRIVATE_WRITE,
      endpoint: "POST /api/auth/tokens",
    });
    expect(registry.list()).toEqual([
      {
        id: "mint-token",
        kind: "action",
        classification: "private-write",
        endpoint: "POST /api/auth/tokens",
      },
    ]);
  });

  it("re-registering an identical descriptor is a no-op", () => {
    const registry = createProductOperationRegistry();
    const descriptor = {
      id: "list-pulls",
      kind: OPERATION_KIND.QUERY,
      classification: WRITE_CLASSIFICATION.READ,
      endpoint: "GET /api/pulls",
    } as const;
    registry.register(descriptor);
    registry.register(descriptor);
    expect(registry.list()).toHaveLength(1);
  });

  it("throws when the same id re-registers with a different descriptor", () => {
    const registry = createProductOperationRegistry();
    const descriptor = {
      id: "list-pulls",
      kind: OPERATION_KIND.QUERY,
      classification: WRITE_CLASSIFICATION.READ,
      endpoint: "GET /api/pulls",
    } as const;
    registry.register(descriptor);
    expect(() =>
      registry.register({ ...descriptor, endpoint: "GET /api/other" }),
    ).toThrowError(/list-pulls/);
    expect(() =>
      registry.register({
        ...descriptor,
        kind: OPERATION_KIND.ACTION,
        classification: WRITE_CLASSIFICATION.PRIVATE_WRITE,
      }),
    ).toThrowError(/list-pulls/);
  });

  it.each(["ListPulls", "list_pulls", "list pulls", "", "-lead", "trail-"])(
    "throws on a non-kebab-case id: %j",
    (id) => {
      const registry = createProductOperationRegistry();
      expect(() =>
        registry.register({
          id,
          kind: OPERATION_KIND.QUERY,
          classification: WRITE_CLASSIFICATION.READ,
          endpoint: "GET /api/probe",
        }),
      ).toThrowError(/kebab-case/);
    },
  );

  it("list() is a snapshot — later registrations do not mutate it", () => {
    const registry = createProductOperationRegistry();
    registry.register({
      id: "read-pull",
      kind: OPERATION_KIND.QUERY,
      classification: WRITE_CLASSIFICATION.READ,
      endpoint: "GET /api/a",
    });
    const snapshot = registry.list();
    registry.register({
      id: "read-brief",
      kind: OPERATION_KIND.QUERY,
      classification: WRITE_CLASSIFICATION.READ,
      endpoint: "GET /api/b",
    });
    expect(snapshot).toHaveLength(1);
  });
});

const QUERY = {
  id: ProductQueryIds.LIST_PULLS,
  classification: WRITE_CLASSIFICATION.READ,
} as const;
const ACTION = {
  id: ProductActionIds.SUBMIT_REVIEW,
  classification: WRITE_CLASSIFICATION.EXTERNAL_WRITE,
} as const;

/** What the auth middleware contributes, as far as the scope check cares. */
interface SessionEnv {
  Variables: { session: { scope: string } };
}

/** Stand in for the auth middleware: put a principal carrying `scope` in ctx. */
function scopeSetter(
  scope: WriteClassification,
): MiddlewareHandler<SessionEnv> {
  return async (c, next) => {
    c.set("session", { scope });
    await next();
  };
}

describe("product router", () => {
  it("query mounts a GET the underlying app serves", async () => {
    const router = productRouter();
    router.query(QUERY, "/pulls", (c) => c.json({ ok: true }));
    const res = await router.app.request("/pulls");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("action mounts each declared method", async () => {
    const router = productRouter<SessionEnv>();
    router.use(scopeSetter(WRITE_CLASSIFICATION.EXTERNAL_WRITE));
    router.action(ACTION, "post", "/review", (c) => c.json({ ok: true }));
    router.action(
      {
        id: ProductActionIds.REVOKE_TOKEN,
        classification: WRITE_CLASSIFICATION.PRIVATE_WRITE,
      },
      "delete",
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
      {
        id: ProductQueryIds.READ_CONVERSATION,
        classification: WRITE_CLASSIFICATION.READ,
      },
      "/conversation",
      (c) => c.body(null, 204),
    );
    pr.action(ACTION, "post", "/review", (c) => c.body(null, 204));
    const repos = productRouter();
    repos.query(
      {
        id: ProductQueryIds.LIST_REPOS,
        classification: WRITE_CLASSIFICATION.READ,
      },
      "/",
      (c) => c.body(null, 204),
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
    const child = productRouter();
    child.query(QUERY, "/", (c) => c.body(null, 204));
    child.action(ACTION, "post", "/review", (c) => c.body(null, 204));
    const root = productRouter();
    root.route("/api", productRouterWrapping("/pulls", child));
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
      root.query(QUERY, "/pulls", (c) => c.body(null, 204));
      root.commit(registry);
    }
    expect(registry.list()).toHaveLength(1);
  });

  it("the same id at a different endpoint conflicts at commit", () => {
    const registry = createProductOperationRegistry();
    const first = productRouter();
    first.query(QUERY, "/pulls", (c) => c.body(null, 204));
    first.commit(registry);
    const second = productRouter();
    second.query(QUERY, "/pulls-v2", (c) => c.body(null, 204));
    expect(() => second.commit(registry)).toThrowError(/list-pulls/);
  });

  it("rejects wrong classifications at compile time and at runtime", () => {
    const router = productRouter();
    expect(() =>
      router.query(
        {
          id: ProductQueryIds.LIST_PULLS,
          // @ts-expect-error — a query must declare READ, not a write classification
          classification: WRITE_CLASSIFICATION.EXTERNAL_WRITE,
        },
        "/pulls",
        (c) => c.body(null, 204),
      ),
    ).toThrowError(/list-pulls/);
    expect(() =>
      router.action(
        {
          id: ProductActionIds.SUBMIT_REVIEW,
          // @ts-expect-error — an action must declare a write classification, not READ
          classification: WRITE_CLASSIFICATION.READ,
        },
        "post",
        "/review",
        (c) => c.body(null, 204),
      ),
    ).toThrowError(/submit-review/);
  });

  it("rejects ids outside the vocabulary at compile time", () => {
    const registry = createProductOperationRegistry();
    const router = productRouter();
    router.query(
      {
        // @ts-expect-error — a query id must come from ProductQueryIds
        id: "not-in-the-vocabulary",
        classification: WRITE_CLASSIFICATION.READ,
      },
      "/probe",
      (c) => c.body(null, 204),
    );
    router.action(
      {
        // @ts-expect-error — an action id must come from ProductActionIds
        id: ProductQueryIds.LIST_PULLS,
        classification: WRITE_CLASSIFICATION.PRIVATE_WRITE,
      },
      "post",
      "/probe",
      (c) => c.body(null, 204),
    );
    // The pins above are compile-time; runtime still records both entries.
    router.commit(registry);
    expect(registry.list()).toHaveLength(2);
  });

  it("a mounted child is sealed — late declarations throw", () => {
    const child = productRouter();
    child.query(QUERY, "/pulls", (c) => c.body(null, 204));
    const root = productRouter();
    root.route("/api", child);
    expect(() =>
      child.action(ACTION, "post", "/review", (c) => c.body(null, 204)),
    ).toThrowError(/mounted/);
  });

  it("a mounted child is sealed — late mounts and commits throw", () => {
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

  it("a mounted child is sealed — late middleware throws", () => {
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

  it("a committed router is sealed — later declarations throw", () => {
    const root = productRouter();
    root.query(QUERY, "/pulls", (c) => c.body(null, 204));
    root.commit(createProductOperationRegistry());
    // Anything added now is served but never registered — silent drift.
    expect(() =>
      root.action(ACTION, "post", "/review", (c) => c.body(null, 204)),
    ).toThrowError(/committed/);
    expect(() =>
      root.query(
        {
          id: ProductQueryIds.LIST_REPOS,
          classification: WRITE_CLASSIFICATION.READ,
        },
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
    child.query(QUERY, "/pulls", (c) => c.body(null, 204));
    child.commit(registry);
    const root = productRouter();
    // Otherwise its operations re-register under the new prefix.
    expect(() => root.route("/api", child)).toThrowError(/already committed/);
    expect(registry.list().map((d) => d.endpoint)).toEqual(["GET /pulls"]);
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
    root.query(QUERY, "/pulls", (c) => c.body(null, 204));
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

  it("use() applies middleware ahead of declared handlers", async () => {
    const router = productRouter();
    router.use(async (c, next) => {
      c.header("x-probe", "on");
      await next();
    });
    router.query(QUERY, "/pulls", (c) => c.body(null, 204));
    const res = await router.app.request("/pulls");
    expect(res.headers.get("x-probe")).toBe("on");
  });

  it("route() mounts a bare Hono without registering anything", async () => {
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

/** Wrap a child under one extra prefix — composition-index shorthand. */
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
  function actionApp(scope: WriteClassification | undefined) {
    const router = productRouter<SessionEnv>();
    if (scope !== undefined) {
      router.use(scopeSetter(scope));
    }
    router.action(ACTION, "post", "/review", (c) => c.json({ ok: true }));
    router.action(
      {
        id: ProductActionIds.GENERATE_BRIEF,
        classification: WRITE_CLASSIFICATION.PRIVATE_WRITE,
      },
      "post",
      "/generate",
      (c) => c.json({ ok: true }),
    );
    router.query(QUERY, "/pulls", (c) => c.json({ ok: true }));
    return router.app;
  }

  it("refuses a read-scoped credential on either write class", async () => {
    const app = actionApp(WRITE_CLASSIFICATION.READ);
    for (const path of ["/generate", "/review"]) {
      const res = await post(app, path);
      expect(res.status).toBe(403);
      expect(await res.json()).toMatchObject({ code: "scope-exceeded" });
    }
  });

  it("lets a read-scoped credential read", async () => {
    const res = await actionApp(WRITE_CLASSIFICATION.READ).request("/pulls");
    expect(res.status).toBe(200);
  });

  it("stops a private-write credential at the instance boundary", async () => {
    const app = actionApp(WRITE_CLASSIFICATION.PRIVATE_WRITE);
    expect((await post(app, "/generate")).status).toBe(200);
    const external = await post(app, "/review");
    expect(external.status).toBe(403);
    expect(await external.json()).toMatchObject({ code: "scope-exceeded" });
  });

  it("lets an external-write credential through everywhere", async () => {
    const app = actionApp(WRITE_CLASSIFICATION.EXTERNAL_WRITE);
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
    router.action(ACTION, "post", "/review", (c) => c.json({ ok: true }));
    expect((await post(router.app, "/review")).status).toBe(401);
  });
});
