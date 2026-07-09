// Multi-org session endpoints (BRIEF-19 PR 2.1 — ADR 0016 #4 as amended, ADR
// 0018 D14). Two session-gated routes let a reviewer who spans installations
// see and switch which one their session is bound to:
//   GET  /auth/installations  → the LIVE accessible set (id + account login)
//                               annotated with current (session) + default
//                               (user_settings).
//   POST /auth/installation   → { installationId, setDefault? } — rebind the
//                               session to a DIFFERENT installation.
//
// TRUST SHAPE (the whole point): the accessible set is ALWAYS re-derived from
// GitHub with the viewer's own token (`GET /user/installations`) — never taken
// from the caller. A switch target is honoured ONLY if it is in that live set;
// otherwise 403 with NO session/settings mutation (D14: dangling ids degrade,
// never bind). A 401 from the ~8h access token drives ONE serialized refresh
// then a single retry, exactly like the per-repo gate and the PR list.
//
// The session row's `installation_id` IS the tenant stamp, so the rebinding is
// an atomic, ctx-safe `reviewer_session` UPDATE (persistence `rebindInstallation`),
// and the switch emits a D9 `auth` audit row (numeric-only metadata).
import { Hono } from "hono";
import { GitHubApiErrorCode, listUserInstallations, type UserInstallation } from "github";
import {
  audit,
  AuditAction,
  AuditActorType,
  AuditMetadataKey,
  decryptToken,
  isInstallationId,
  sessionAuth,
  userSettingsStore,
  type InstallationId,
} from "persistence";
import type { Result } from "types";
import { z } from "zod";
import { refreshSessionToken, type AuthRouteDeps, type ViewerPrincipal } from "./auth";
import { accessLogLayer, sessionLayer, type AuthzEnv } from "./authz";

/** The switch body — `installationId` as a numeric string or JSON number. */
const switchBodySchema = z.object({
  installationId: z.union([z.string().min(1), z.number().int()]),
  setDefault: z.boolean().optional(),
});

/** Brand a caller-supplied installation id; `undefined` when it isn't a positive int. */
function toInstallationId(raw: string | number): InstallationId | undefined {
  let value: bigint;
  if (typeof raw === "number") {
    if (!Number.isSafeInteger(raw)) {
      return undefined;
    }
    value = BigInt(raw);
  } else {
    if (!/^\d+$/.test(raw)) {
      return undefined;
    }
    value = BigInt(raw);
  }
  return isInstallationId(value) ? value : undefined;
}

/** The live accessible set plus the (possibly refreshed) session it was read under. */
interface AccessibleSet {
  readonly installations: readonly UserInstallation[];
  readonly session: ViewerPrincipal;
}

/**
 * Re-derive the viewer's accessible installation set from GitHub with the
 * session's token, refreshing ONCE on a 401 (expired ~8h access token). Failure
 * carries the HTTP status the route should return: 401 (auth dead → re-login)
 * or 502 (GitHub upstream error). An unreadable stored token burns the session.
 */
async function resolveAccessibleInstallations(
  deps: AuthRouteDeps,
  session: ViewerPrincipal,
): Promise<Result<AccessibleSet, { status: 401 | 502 }>> {
  const decrypted = await decryptToken(
    deps.auth.keyProvider,
    session.keyRef,
    session.ghTokenCiphertext,
  );
  if (!decrypted.ok) {
    // Unreadable token burns the session — same posture as the repo gate / list.
    await sessionAuth(deps.handle).deleteSession(session.sessionTokenHash);
    return { ok: false, error: { status: 401 } };
  }

  let currentSession = session;
  let accessToken = decrypted.value;
  let result = await listUserInstallations(accessToken);
  if (!result.ok && result.error.code === GitHubApiErrorCode.UNAUTHORIZED) {
    const refreshed = await refreshSessionToken(deps, currentSession);
    if (!refreshed.ok) {
      // The orchestrator already burned the session on a hard failure.
      return { ok: false, error: { status: 401 } };
    }
    currentSession = refreshed.value.session;
    accessToken = refreshed.value.accessToken;
    result = await listUserInstallations(accessToken);
  }
  if (!result.ok) {
    const status = result.error.code === GitHubApiErrorCode.UNAUTHORIZED ? 401 : 502;
    return { ok: false, error: { status } };
  }
  return { ok: true, value: { installations: result.value, session: currentSession } };
}

/**
 * Mount the multi-org session endpoints over the session gate (no `:repoId`, so
 * `sessionLayer` alone — same composition as the PR list).
 */
export function installationsRoute(deps: AuthRouteDeps): Hono<AuthzEnv> {
  const app = new Hono<AuthzEnv>();

  app.use("/auth/installations", sessionLayer(deps), accessLogLayer());
  app.use("/auth/installation", sessionLayer(deps), accessLogLayer());

  // GET: the accessible set annotated with current (session) + default (settings).
  app.get("/auth/installations", async (c) => {
    const session = c.get("session");
    const resolved = await resolveAccessibleInstallations(deps, session);
    if (!resolved.ok) {
      return c.json(
        { error: resolved.error.status === 401 ? "unauthorized" : "upstream error" },
        resolved.error.status,
      );
    }
    const { installations, session: currentSession } = resolved.value;
    const settings = await userSettingsStore(deps.handle).get(currentSession.reviewerId);
    const defaultId = settings?.defaultInstallationId ?? null;
    const currentId = currentSession.installationId;

    const body = {
      installations: installations.map((installation) => ({
        installationId: String(installation.installationId),
        accountLogin: installation.accountLogin,
        isCurrent: installation.installationId === currentId,
        isDefault: defaultId !== null && installation.installationId === defaultId,
      })),
      currentInstallationId: String(currentId),
      defaultInstallationId: defaultId === null ? null : String(defaultId),
    };
    return c.json(body, 200, { "cache-control": "no-store" });
  });

  // POST: rebind the session to a different installation (validated live).
  app.post("/auth/installation", async (c) => {
    const raw: unknown = await c.req.json().catch(() => undefined);
    const parsed = switchBodySchema.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: "invalid request body" }, 400);
    }
    const target = toInstallationId(parsed.data.installationId);
    if (target === undefined) {
      return c.json({ error: "invalid installation id" }, 400);
    }

    const session = c.get("session");
    const resolved = await resolveAccessibleInstallations(deps, session);
    if (!resolved.ok) {
      return c.json(
        { error: resolved.error.status === 401 ? "unauthorized" : "upstream error" },
        resolved.error.status,
      );
    }
    const { installations, session: currentSession } = resolved.value;

    // Validate against the LIVE set — never trust the caller's id. A target the
    // viewer can no longer reach is a 403 + a D9 denial, and NOTHING mutates.
    if (!installations.some((installation) => installation.installationId === target)) {
      await audit(deps.handle, {
        installationId: currentSession.installationId,
        actorType: AuditActorType.REVIEWER,
        actorId: currentSession.reviewerId,
        action: AuditAction.AUTH,
        targetType: "installation",
        targetId: target,
        metadata: { [AuditMetadataKey.DECISION]: "403" },
      });
      return c.json({ error: "forbidden" }, 403);
    }

    // Atomic, ctx-safe rebinding of the session's tenant stamp.
    const rebound = await sessionAuth(deps.handle).rebindInstallation(
      currentSession.sessionTokenHash,
      target,
    );
    if (!rebound.ok) {
      // The row vanished between resolve and rebind (logout / sweep) → re-login.
      return c.json({ error: "unauthorized" }, 401);
    }

    let defaultId = (await userSettingsStore(deps.handle).get(currentSession.reviewerId))
      ?.defaultInstallationId ?? null;
    if (parsed.data.setDefault === true) {
      const updated = await userSettingsStore(deps.handle).setDefaultInstallation(
        currentSession.reviewerId,
        target,
      );
      defaultId = updated.defaultInstallationId;
    }

    // D9: record the successful switch (numeric-only metadata) under the NEW tenant.
    await audit(deps.handle, {
      installationId: target,
      actorType: AuditActorType.REVIEWER,
      actorId: currentSession.reviewerId,
      action: AuditAction.AUTH,
      targetType: "installation",
      targetId: target,
      metadata: { [AuditMetadataKey.DECISION]: "200" },
    });

    return c.json(
      {
        currentInstallationId: String(target),
        defaultInstallationId: defaultId === null ? null : String(defaultId),
      },
      200,
      { "cache-control": "no-store" },
    );
  });

  return app;
}
