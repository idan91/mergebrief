// Route declaration and catalog registration as ONE statement: an endpoint
// cannot mount without its operation descriptor, so the composed surface and
// the registry cannot drift apart.
//
// Endpoints are assembled mechanically: each router keeps its declarations
// under router-relative paths, `.route()` absorbs a child's entries beneath
// the mount prefix (the child is sealed, declare before mounting), and the
// composition root's `commit` stamps `METHOD /full/path`, asserts it against
// the operation table and registers.
import { Hono } from "hono";
import { every } from "hono/combine";
import type { Env, H, MiddlewareHandler } from "hono/types";
import { HttpMethods, type HttpMethod, type ValueOf } from "types";
import {
  OperationKinds,
  ProductOperations,
  formatEndpoint,
  formatProductEndpoint,
  type ActionHttpMethod,
  type OperationKind,
  type ProductActionId,
  type ProductActionRow,
  type ProductEndpoint,
  type ProductOperationId,
  type ProductOperationRow,
  type ProductOperationTable,
  type ProductQueryId,
  type ProductQueryRow,
} from "contract";
import type { PullRequestEnv } from "../access/types";
import { buildErrorResponse } from "../error-response";
import { ApiError } from "../shared-errors/api-error";
import { createPolicyGate } from "./policy-gate";
import type { ProductOperationRegistry } from "./registry";
import type {
  OperationPolicy,
  ProductActionDescriptor,
  ProductQueryDescriptor,
} from "./types";

export interface ProductQueryDeclaration<
  RequiresStoredPullRequest extends boolean = boolean,
> extends OperationPolicy {
  readonly id: ProductQueryId;
  readonly requiresStoredPullRequest: RequiresStoredPullRequest;
}

export interface ProductActionDeclaration<
  RequiresStoredPullRequest extends boolean = boolean,
> extends OperationPolicy {
  readonly id: ProductActionId;
  readonly requiresStoredPullRequest: RequiresStoredPullRequest;
}

/** A router whose handlers read the stored pull request admits only operations that load one. */
type StoredPullRequestRequirementFor<E extends Env> = E extends PullRequestEnv
  ? true
  : boolean;

type PendingDescriptor =
  | Omit<ProductQueryDescriptor, "endpoint">
  | Omit<ProductActionDescriptor, "endpoint">;

interface PendingOperation {
  readonly id: ProductOperationId;
  readonly descriptor: PendingDescriptor;
  readonly method: HttpMethod;
  /** Router-relative path; prefixed on each absorb toward the root. */
  readonly path: string;
}

/** Mirror Hono's mount-time path merge so stamped endpoints match `routes`. */
function joinPaths(prefix: string, path: string): string {
  const left = prefix === "/" ? "" : prefix;
  if (path === "/") {
    return left === "" ? "/" : left;
  }
  return `${left}${path}`;
}

function resolveRow<Id extends ProductOperationId>(
  id: Id,
): ProductOperationTable[Id] {
  const row: ProductOperationTable[Id] | undefined = ProductOperations[id];
  if (row === undefined) {
    throw new Error(
      `product operation "${id}" has no row in the operation table`,
    );
  }
  return row;
}

function stampEndpoint(entry: PendingOperation): ProductEndpoint {
  const composed = formatEndpoint(entry.method, entry.path);
  const endpoint = formatProductEndpoint(entry.id);
  if (composed !== endpoint) {
    throw new Error(
      `product operation "${entry.id}" composes as "${composed}" but its operation table row is "${endpoint}"`,
    );
  }
  return endpoint;
}

function isActionHttpMethod(method: HttpMethod): method is ActionHttpMethod {
  return method !== HttpMethods.GET;
}

function formatKindMismatch(
  id: ProductOperationId,
  actual: OperationKind,
  declared: OperationKind,
): string {
  const message = `product operation "${id}" has kind "${actual}", not "${declared}"`;
  return message;
}

// A declaration's id is typed only, so a suppressed type error must fail at
// declaration rather than mount under a method its row does not carry.
function resolveQueryRow(id: ProductOperationId): ProductQueryRow {
  const row: ProductOperationRow = resolveRow(id);
  if (row.kind !== OperationKinds.QUERY) {
    throw new Error(formatKindMismatch(id, row.kind, OperationKinds.QUERY));
  }
  return row;
}

function resolveActionRow(id: ProductOperationId): ProductActionRow {
  const row: ProductOperationRow = resolveRow(id);
  if (row.kind !== OperationKinds.ACTION) {
    throw new Error(formatKindMismatch(id, row.kind, OperationKinds.ACTION));
  }
  if (!isActionHttpMethod(row.method)) {
    throw new Error(`product action "${id}" cannot mount under GET`);
  }
  return row;
}

/** At least one handler, matches Hono's own path-plus-handlers signature. */
type RouteHandlers<E extends Env, P extends string> = [H<E, P>, ...H<E, P>[]];

type MountAction = <E extends Env, P extends string>(
  app: Hono<E>,
  path: P,
  handlers: RouteHandlers<E, P>,
) => void;

const MOUNT_BY_ACTION_METHOD: Readonly<Record<ActionHttpMethod, MountAction>> =
  {
    [HttpMethods.POST]: (app, path, handlers) => {
      app.post(path, ...handlers);
    },
    [HttpMethods.PUT]: (app, path, handlers) => {
      app.put(path, ...handlers);
    },
    [HttpMethods.PATCH]: (app, path, handlers) => {
      app.patch(path, ...handlers);
    },
    [HttpMethods.DELETE]: (app, path, handlers) => {
      app.delete(path, ...handlers);
    },
  };

const SealReasons = {
  MOUNTED: "mounted",
  COMMITTED: "committed",
} as const;
type SealReason = ValueOf<typeof SealReasons>;

const SEAL_CAUSE: Readonly<Record<SealReason, string>> = {
  [SealReasons.MOUNTED]: "mounted into a parent",
  [SealReasons.COMMITTED]: "committed",
};

export interface ProductRouter<E extends Env> {
  /** The underlying Hono, for serving/mounting, never for adding routes. */
  readonly app: Hono<E>;
  /** Middleware passthrough. */
  use(...middleware: MiddlewareHandler<E>[]): void;
  use(path: string, ...middleware: MiddlewareHandler<E>[]): void;
  /** Declare-and-mount a Product Query as GET. */
  query<P extends string>(
    descriptor: ProductQueryDeclaration<StoredPullRequestRequirementFor<E>>,
    path: P,
    ...handlers: RouteHandlers<E, P>
  ): void;
  /** Declare-and-mount a Product Action under its table row's method. */
  action<P extends string>(
    descriptor: ProductActionDeclaration<StoredPullRequestRequirementFor<E>>,
    path: P,
    ...handlers: RouteHandlers<E, P>
  ): void;
  /** Mount a child router (absorbing its operations) or a bare Hono. */
  route<ChildEnv extends Env>(
    prefix: string,
    child: ProductRouter<ChildEnv> | Hono<ChildEnv>,
  ): void;
  /**
   * Stamp full endpoints, assert each against its operation table row and
   * register; call once, on the composition root.
   */
  commit(registry: ProductOperationRegistry): void;
}

export function productRouter<E extends Env = Env>(): ProductRouter<E> {
  const app = new Hono<E>();
  // Hono wraps a mounted sub-app's copied handlers with its custom onError,
  // so this seam renders ApiError throws for composed AND standalone
  // routers (same producer as the root); anything else propagates to the
  // root's sanitized-500 renderer.
  app.onError((err, c) => {
    if (err instanceof ApiError) {
      return buildErrorResponse(c, err.code);
    }
    throw err;
  });
  const pending: PendingOperation[] = [];
  let sealedBy: SealReason | undefined;

  function assertOpen(what: string): void {
    if (sealedBy !== undefined) {
      throw new Error(`${what} after this router was ${SEAL_CAUSE[sealedBy]}`);
    }
  }

  const router: ProductRouter<E> = {
    app,
    use(first: string | MiddlewareHandler<E>, ...rest: MiddlewareHandler<E>[]) {
      if (typeof first === "string") {
        // A late gate applies to this router alone, the parent already
        // copied the route table, so it would silently never run.
        assertOpen(`cannot add middleware for "${first}"`);
        app.use(first, ...rest);
        return;
      }
      assertOpen("cannot add middleware");
      app.use(first, ...rest);
    },
    query(descriptor, path, ...handlers) {
      assertOpen(`cannot declare query "${descriptor.id}"`);
      const row = resolveQueryRow(descriptor.id);
      pending.push({
        id: descriptor.id,
        descriptor: {
          ...descriptor,
          kind: OperationKinds.QUERY,
          classification: row.classification,
        },
        method: row.method,
        path,
      });
      app.get(
        path,
        every(createPolicyGate(descriptor, row.classification), ...handlers),
      );
    },
    action(descriptor, path, ...handlers) {
      assertOpen(`cannot declare action "${descriptor.id}"`);
      const row = resolveActionRow(descriptor.id);
      pending.push({
        id: descriptor.id,
        descriptor: {
          ...descriptor,
          kind: OperationKinds.ACTION,
          classification: row.classification,
        },
        method: row.method,
        path,
      });
      // ONE composed handler, not a prepended one: Hono records a route-table
      // entry per handler, and a doubled entry would read as a double mount.
      const gate = createPolicyGate(descriptor, row.classification);
      MOUNT_BY_ACTION_METHOD[row.method](app, path, [every(gate, ...handlers)]);
    },
    route(prefix, child) {
      assertOpen(`cannot mount "${prefix}"`);
      // A malformed prefix would stamp endpoints that drift from Hono's
      // own path merge, reject it instead of stamping a lie.
      if (prefix !== "/" && (!prefix.startsWith("/") || prefix.endsWith("/"))) {
        throw new Error(
          `mount prefix ${JSON.stringify(prefix)} must start with "/" and not end with "/"`,
        );
      }
      if (child instanceof Hono) {
        app.route(prefix, child);
        return;
      }
      // Absorb first: a rejected mount must not leave the child's routes in
      // this parent with its operations unregistered.
      const absorbed = absorb(child, prefix);
      app.route(prefix, child.app);
      for (const entry of absorbed) {
        pending.push({ ...entry, path: joinPaths(prefix, entry.path) });
      }
    },
    commit(registry) {
      assertOpen("cannot commit");
      // Every entry is checked before any registers: a mismatch leaves the
      // registry as it was.
      const stamped = pending.map((entry) => ({
        descriptor: entry.descriptor,
        endpoint: stampEndpoint(entry),
      }));
      for (const { descriptor, endpoint } of stamped) {
        // Branch per kind so the registered union member stays discriminated.
        if (descriptor.kind === OperationKinds.QUERY) {
          registry.register({ ...descriptor, endpoint });
        } else {
          registry.register({ ...descriptor, endpoint });
        }
      }
      // Post-commit declarations would serve but never register.
      sealedBy = SealReasons.COMMITTED;
    },
  };

  function absorb(child: object, prefix: string): readonly PendingOperation[] {
    const entries = internals.get(child);
    if (entries === undefined) {
      throw new Error("cannot mount a product router from another factory");
    }
    return entries.take(prefix);
  }

  internals.set(router, {
    take(prefix) {
      if (sealedBy !== undefined) {
        throw new Error(
          `cannot mount "${prefix}": this router was already ${SEAL_CAUSE[sealedBy]}`,
        );
      }
      sealedBy = SealReasons.MOUNTED;
      // Hand the entries over once, the parent owns them now.
      return pending.splice(0, pending.length);
    },
  });

  return router;
}

// Parent routers pull a child's pending entries through this side channel so
// the public interface stays declaration-only.
interface RouterInternals {
  take(prefix: string): readonly PendingOperation[];
}
const internals = new WeakMap<object, RouterInternals>();
