import {
  type Mutable,
  type PullRequestSource,
  PullRequestSources,
  AccessLevels,
} from "types";
// ONE emit for every Product Action and every denial of one.
//
// Mounted at the ROOT, not inside `action()`: the per-repo gate refuses
// before any route handler runs, so only a middleware wrapping the gates can
// record that denial. The operation still comes from the router's descriptor.
//
// Never a read. Never a body, never free text. A row this cannot attribute to
// a tenant is not written at all; an unauthenticated or unresolvable
// credential leaves only its `api.access` line.
import type { Context, MiddlewareHandler } from "hono";
import {
  writeAudit,
  AuditActorTypes,
  AuditMetadataKeys,
  AuditChannels,
  AuditOutcomes,
  AuditRequestIdSchema,
  isOwnerContext,
  type AppDatabase,
  type InstallationId,
  type AuditChannel,
  type AuditOutcome,
  type ScopeContext,
} from "persistence";
import { OperationKinds } from "contract";
import type { RequestLogEnv } from "../request-logging";
import type { ProductOperationRegistry } from "./registry";
import { createOperationResolver } from "./resolve-operation";
import type { ProductActionDescriptor } from "./types";

declare module "hono" {
  interface ContextVariableMap {
    /** The descriptor id this request resolved to; also rides `api.access`. */
    operation?: string;
    /** The row the action acted on, stamped by the handler that knows it. */
    auditTarget?: { readonly type: string; readonly id?: bigint };
    /**
     * Why a denial was refused, when the wire code is a deliberate collapse
     * (the gate answers 404 to avoid leaking existence; the ledger still says
     * `no-repo-access`).
     */
    auditReason?: string;
    /**
     * The scope the request acted in, set by each access step in turn: the
     * credential's own, then the repo's, then the pull request row's.
     */
    auditScope?: ScopeContext;
  }
}

/** Denial reason for the per-repo gate's uniform 404. */
export const AUDIT_REASON_NO_REPO_ACCESS = "no-repo-access";
/** Denial reason for a cookie mutation that proved no same-origin. */
export const AUDIT_REASON_CROSS_ORIGIN = "cross-origin";

/** Which audit rows this instance writes. Both knobs are instance config. */
export interface AuditEmitConfig {
  /** `AUDIT_PRIVATE_WRITES`; default on. External writes and denials are
   * never switchable: an instance able to post to GitHub with no record is
   * not a configuration. */
  readonly privateWrites: boolean;
  /** `AUDIT_CALLER_IP`; default off. Socket address only; see
   * `docs/self-host/operations.md` for the reverse-proxy caveat. */
  readonly callerIp: boolean;
}

const DEFAULT_CONFIG: AuditEmitConfig = {
  privateWrites: true,
  callerIp: false,
};

export interface AuditEmitDeps {
  readonly handle: AppDatabase;
  readonly registry: ProductOperationRegistry;
  readonly audit?: AuditEmitConfig;
}

/** Record the row an action acted on; ids only, never a body. */
export function stampAuditTarget(
  c: { set(key: "auditTarget", value: { type: string; id?: bigint }): void },
  type: string,
  id?: bigint,
): void {
  const auditTarget: { type: string; id?: bigint } = { type };
  if (id !== undefined) {
    auditTarget.id = id;
  }
  c.set("auditTarget", auditTarget);
}

/** Record the scope the request acts in; a later access step narrows it. */
export function stampAuditScope(
  c: { set(key: "auditScope", value: ScopeContext): void },
  scope: ScopeContext,
): void {
  c.set("auditScope", scope);
}

/** Name a denial whose wire code is a deliberate collapse. */
export function stampAuditReason(
  c: { set(key: "auditReason", value: string): void },
  reason: string,
): void {
  c.set("auditReason", reason);
}

/**
 * Whether this row is written at all. `ok` private writes are the one
 * switchable class; denials and failures are security signal, and external
 * writes left the instance.
 */
export function isAuditRowWritten(
  classification: ProductActionDescriptor["classification"],
  outcome: AuditOutcome,
  privateWrites: boolean,
): boolean {
  const written =
    privateWrites ||
    outcome !== AuditOutcomes.OK ||
    classification !== AccessLevels.PRIVATE_WRITE;
  return written;
}

const SERVER_ERROR = 500;
const CLIENT_ERROR = 400;

function getOutcome(status: number): AuditOutcome {
  if (status >= SERVER_ERROR) {
    return AuditOutcomes.FAILED;
  }
  return status >= CLIENT_ERROR ? AuditOutcomes.DENIED : AuditOutcomes.OK;
}

/**
 * The one client this instance can attest: its own CLI. Forensic only;
 * NOTHING MAY EVER BRANCH ON IT. Matched against a fixed product name, never
 * a shape: a shape admits `192.168.4.17/24`, writing a caller's own address
 * into the ledger with the PII flag off. Stays inside `AuditClientSchema`, so
 * a derived value can never be what makes the insert throw and lose the row.
 */
const MERGEBRIEF_CLIENT = /^mergebrief\/[0-9A-Za-z][0-9A-Za-z.-]{0,20}$/;

export function deriveClient(
  userAgent: string | undefined,
): string | undefined {
  const first = userAgent?.trim().split(/\s+/)[0];
  return first !== undefined && MERGEBRIEF_CLIENT.test(first)
    ? first
    : undefined;
}

// A caller-settable id the ledger rejects would throw the emit and lose the row.
export function deriveRequestId(
  requestId: string | undefined,
): string | undefined {
  return requestId !== undefined &&
    AuditRequestIdSchema.safeParse(requestId).success
    ? requestId
    : undefined;
}

/** An address as a socket reports it; anything else is dropped. */
const IP_ADDRESS = /^[0-9a-fA-F.:]{1,45}$/;

/**
 * The SOCKET address, when the serving adapter exposes one. Behind a reverse
 * proxy this is the proxy's address: `X-Forwarded-For` is client-settable, and
 * trusting it is a decision this instance has not made.
 */
function getSocketAddress(c: Context): string | undefined {
  const env: unknown = c.env;
  if (typeof env !== "object" || env === null || !("incoming" in env)) {
    return undefined;
  }
  const incoming: unknown = env.incoming;
  if (
    typeof incoming !== "object" ||
    incoming === null ||
    !("socket" in incoming)
  ) {
    return undefined;
  }
  const socket: unknown = incoming.socket;
  if (
    typeof socket !== "object" ||
    socket === null ||
    !("remoteAddress" in socket) ||
    typeof socket.remoteAddress !== "string" ||
    !IP_ADDRESS.test(socket.remoteAddress)
  ) {
    return undefined;
  }
  return socket.remoteAddress;
}

/** The acting credential, narrowed structurally off the auth layers' variable. */
interface AuditPrincipal {
  readonly reviewerId: bigint;
  readonly credentialId: bigint;
  readonly channel: AuditChannel;
}

function isAuditChannel(value: unknown): value is AuditChannel {
  return Object.values(AuditChannels).some((known) => known === value);
}

/** One variable out of the context bag, unnarrowed; the callers guard it. */
function readVar(variables: unknown, key: string): unknown {
  if (typeof variables !== "object" || variables === null) {
    return undefined;
  }
  if (!(key in variables)) {
    return undefined;
  }
  const bag: Record<string, unknown> = { ...variables };
  return bag[key];
}

function readAuditPrincipal(value: unknown): AuditPrincipal | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  if (!("reviewerId" in value) || !("id" in value) || !("channel" in value)) {
    return undefined;
  }
  const { reviewerId, id, channel } = value;
  if (
    typeof reviewerId !== "bigint" ||
    typeof id !== "bigint" ||
    !isAuditChannel(channel)
  ) {
    return undefined;
  }
  return { reviewerId, credentialId: id, channel };
}

interface AuditScope {
  readonly installationId: InstallationId | null;
  readonly source: PullRequestSource;
}

/**
 * The row's scope when a row resolved, else the repo's, else the
 * credential's own: an owner scope is a URL row's, so its installation is
 * NULL.
 */
function deriveAuditScope(
  scope: ScopeContext | undefined,
): AuditScope | undefined {
  if (scope === undefined) {
    return undefined;
  }
  if (isOwnerContext(scope)) {
    return { installationId: null, source: PullRequestSources.URL };
  }
  return {
    installationId: scope.installationId,
    source: PullRequestSources.INSTALLATION,
  };
}

/**
 * Mount ONCE at the composition root, ahead of the routes. Stamps `operation`
 * for the `api.access` line (queries included); writes the row for actions.
 */
export function createAuditMiddleware(
  deps: AuditEmitDeps,
): MiddlewareHandler<RequestLogEnv> {
  const config = deps.audit ?? DEFAULT_CONFIG;
  const resolveOperation = createOperationResolver(deps.registry);

  return async (c, next) => {
    await next();
    const descriptor = resolveOperation(c);
    if (descriptor === undefined) {
      return;
    }
    c.set("operation", descriptor.id);
    if (descriptor.kind !== OperationKinds.ACTION) {
      return;
    }
    const outcome = getOutcome(c.res.status);
    if (
      !isAuditRowWritten(
        descriptor.classification,
        outcome,
        config.privateWrites,
      )
    ) {
      return;
    }
    // `session` belongs to the auth layers, so it is read out of the variable
    // bag and narrowed here rather than declared on this module.
    const session = readVar(c.var, "session");
    const scope = deriveAuditScope(c.get("auditScope"));
    const principal = readAuditPrincipal(session);
    if (scope === undefined || principal === undefined) {
      // A credential that resolves to no scope at all cannot be recorded,
      // and leaves only its `api.access` line.
      return;
    }
    const target = c.get("auditTarget");
    const client = deriveClient(c.req.header("user-agent"));
    const callerIp = config.callerIp ? getSocketAddress(c) : undefined;
    const requestId = deriveRequestId(c.get("requestId"));
    const reason = c.get("auditReason") ?? c.get("apiErrorCode");
    const row: Mutable<Parameters<typeof writeAudit>[1]> = {
      installationId: scope.installationId,
      source: scope.source,
      actorType: AuditActorTypes.REVIEWER,
      actorId: principal.reviewerId,
      operation: descriptor.id,
      outcome,
      classification: descriptor.classification,
      channel: principal.channel,
      credentialId: principal.credentialId,
    };
    if (requestId !== undefined) {
      row.requestId = requestId;
    }
    if (client !== undefined) {
      row.client = client;
    }
    if (callerIp !== undefined) {
      row.callerIp = callerIp;
    }
    if (target !== undefined) {
      row.targetType = target.type;
    }
    if (target?.id !== undefined) {
      row.targetId = target.id;
    }
    if (reason !== undefined) {
      row.metadata = { [AuditMetadataKeys.REASON]: reason };
    }
    try {
      await writeAudit(deps.handle, row);
    } catch (error) {
      // The action already happened; an external write may already have left
      // the instance. Never turn a landed action into an error response over
      // the ledger; a missing row is a data-integrity signal instead.
      c.get("logger").error("audit emit failed after a completed action", {
        evt: "audit.fail",
        operation: descriptor.id,
        err: error,
      });
    }
  };
}
