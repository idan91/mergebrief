// Route declaration and catalog registration as ONE statement: an endpoint
// cannot mount without its operation descriptor, so the composed surface and
// the registry cannot drift apart.
//
// Endpoints are assembled mechanically: each router keeps its declarations
// under router-relative paths, `.route()` absorbs a child's entries beneath
// the mount prefix (the child is sealed — declare before mounting), and the
// composition root's `commit` stamps `METHOD /full/path` and registers.
import { Hono } from "hono";
import { every } from "hono/combine";
import type { Env, H, MiddlewareHandler } from "hono/types";
import type { WriteClassification } from "persistence";
import type { ValueOf } from "types";
import type { ProductActionId, ProductQueryId } from "./ids";
import type { ProductOperationRegistry } from "./registry";
import {
  isWriteClassification,
  OPERATION_KIND,
  scopeReaches,
  WRITE_CLASSIFICATION,
  type ActionClassification,
  type ProductActionDescriptor,
  type ProductQueryDescriptor,
} from "./types";
import { ApiErrorCodes, buildErrorResponse } from "../error-response";
import { ApiError, Forbidden, Unauthorized } from "../shared-errors/api-error";

export const ACTION_METHOD = {
  POST: "post",
  DELETE: "delete",
  PATCH: "patch",
  PUT: "put",
} as const;
export type ActionMethod = ValueOf<typeof ACTION_METHOD>;

/** A query declaration — id from the query vocabulary, read-only by type. */
export interface ProductQueryDeclaration {
  readonly id: ProductQueryId;
  readonly classification: typeof WRITE_CLASSIFICATION.READ;
}

/** An action declaration — id from the action vocabulary, a write class. */
export interface ProductActionDeclaration {
  readonly id: ProductActionId;
  readonly classification: ActionClassification;
}

type PendingDescriptor =
  | Omit<ProductQueryDescriptor, "endpoint">
  | Omit<ProductActionDescriptor, "endpoint">;

interface PendingOperation {
  readonly descriptor: PendingDescriptor;
  /** Uppercase HTTP method. */
  readonly method: string;
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

/** At least one handler — matches Hono's own path-plus-handlers signature. */
type RouteHandlers<E extends Env, P extends string> = [H<E, P>, ...H<E, P>[]];

function mountAction<E extends Env, P extends string>(
  app: Hono<E>,
  method: ActionMethod,
  path: P,
  handlers: RouteHandlers<E, P>,
): void {
  if (method === ACTION_METHOD.POST) {
    app.post(path, ...handlers);
  } else if (method === ACTION_METHOD.DELETE) {
    app.delete(path, ...handlers);
  } else if (method === ACTION_METHOD.PATCH) {
    app.patch(path, ...handlers);
  } else {
    app.put(path, ...handlers);
  }
}

const SEAL_REASON = {
  MOUNTED: "mounted",
  COMMITTED: "committed",
} as const;
type SealReason = ValueOf<typeof SEAL_REASON>;

const SEAL_CAUSE: Readonly<Record<SealReason, string>> = {
  [SEAL_REASON.MOUNTED]: "mounted into a parent",
  [SEAL_REASON.COMMITTED]: "committed",
};

function hasKey<K extends string>(
  value: unknown,
  key: K,
): value is Record<K, unknown> {
  return typeof value === "object" && value !== null && key in value;
}

/**
 * The credential's scope, read out of the context's variable bag. Structural
 * on purpose: this module is generic over the Hono Env, so the bag arrives as
 * `unknown` and is narrowed here — routes keep their own typed
 * `AuthzVariables` view of the same variable.
 */
function principalScope(variables: unknown): WriteClassification | undefined {
  if (!hasKey(variables, "session") || !hasKey(variables.session, "scope")) {
    return undefined;
  }
  const scope: unknown = variables.session.scope;
  return isWriteClassification(scope) ? scope : undefined;
}

/**
 * The scope check, standardised at the seam so a route added next year is
 * enforced whether or not its author thought about it. Only actions carry it:
 * `read` is the bottom rung, so every scope reaches every query, and the
 * router already refuses to declare a query as anything else.
 *
 * No principal means no credential to read a scope from — that is a route
 * mounted without its gate, so it fails closed rather than fails open.
 */
function scopeGate<E extends Env>(
  classification: ActionClassification,
): MiddlewareHandler<E> {
  return async (c, next) => {
    const scope = principalScope(c.var);
    if (scope === undefined) {
      throw new Unauthorized();
    }
    if (!scopeReaches(scope, classification)) {
      throw new Forbidden(ApiErrorCodes.SCOPE_EXCEEDED);
    }
    await next();
    return undefined;
  };
}

function isActionClassification(value: string): value is ActionClassification {
  return (
    value === WRITE_CLASSIFICATION.PRIVATE_WRITE ||
    value === WRITE_CLASSIFICATION.EXTERNAL_WRITE
  );
}

export interface ProductRouter<E extends Env> {
  /** The underlying Hono — for serving/mounting, never for adding routes. */
  readonly app: Hono<E>;
  /** Middleware passthrough. */
  use(...middleware: MiddlewareHandler<E>[]): void;
  use(path: string, ...middleware: MiddlewareHandler<E>[]): void;
  /** Declare-and-mount a Product Query as GET. */
  query<P extends string>(
    descriptor: ProductQueryDeclaration,
    path: P,
    ...handlers: RouteHandlers<E, P>
  ): void;
  /** Declare-and-mount a Product Action. */
  action<P extends string>(
    descriptor: ProductActionDeclaration,
    method: ActionMethod,
    path: P,
    ...handlers: RouteHandlers<E, P>
  ): void;
  /** Mount a child router (absorbing its operations) or a bare Hono. */
  route<ChildEnv extends Env>(
    prefix: string,
    child: ProductRouter<ChildEnv> | Hono<ChildEnv>,
  ): void;
  /** Stamp full endpoints and register — call once, on the composition root. */
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
      return buildErrorResponse(c, err.code, err.params);
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
        // A late gate applies to this router alone — the parent already
        // copied the route table — so it would silently never run.
        assertOpen(`cannot add middleware for "${first}"`);
        app.use(first, ...rest);
        return;
      }
      assertOpen("cannot add middleware");
      app.use(first, ...rest);
    },
    query(descriptor, path, ...handlers) {
      assertOpen(`cannot declare query "${descriptor.id}"`);
      if (descriptor.classification !== WRITE_CLASSIFICATION.READ) {
        throw new Error(
          `product query "${descriptor.id}" must be classified "read"`,
        );
      }
      pending.push({
        descriptor: { ...descriptor, kind: OPERATION_KIND.QUERY },
        method: "GET",
        path,
      });
      app.get(path, ...handlers);
    },
    action(descriptor, method, path, ...handlers) {
      assertOpen(`cannot declare action "${descriptor.id}"`);
      if (!isActionClassification(descriptor.classification)) {
        throw new Error(
          `product action "${descriptor.id}" must be classified "private-write" or "external-write"`,
        );
      }
      pending.push({
        descriptor: { ...descriptor, kind: OPERATION_KIND.ACTION },
        method: method.toUpperCase(),
        path,
      });
      // ONE composed handler, not a prepended one: Hono records a route-table
      // entry per handler, and a doubled entry would read as a double mount.
      mountAction(app, method, path, [
        every(scopeGate(descriptor.classification), ...handlers),
      ]);
    },
    route(prefix, child) {
      assertOpen(`cannot mount "${prefix}"`);
      // A malformed prefix would stamp endpoints that drift from Hono's
      // own path merge — reject it instead of stamping a lie.
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
      for (const entry of pending) {
        const endpoint = `${entry.method} ${entry.path}`;
        // Branch per kind so the registered union member stays discriminated.
        if (entry.descriptor.kind === OPERATION_KIND.QUERY) {
          registry.register({ ...entry.descriptor, endpoint });
        } else {
          registry.register({ ...entry.descriptor, endpoint });
        }
      }
      // Post-commit declarations would serve but never register.
      sealedBy = SEAL_REASON.COMMITTED;
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
      sealedBy = SEAL_REASON.MOUNTED;
      // Hand the entries over once — the parent owns them now.
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
