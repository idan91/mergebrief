// API-token mint/list/revoke (BRIEF-17 PR 2 — ADR 0016 #4 as amended
// 2026-07-09). The BROWSER-ONLY management surface for the second
// presentation channel:
//   POST   /api/auth/tokens      → mint (token material returned exactly ONCE)
//   GET    /api/auth/tokens      → the viewer's tokens, metadata only
//   DELETE /api/auth/tokens/:id  → owner-scoped soft revoke
// Cookie-authed by construction: these live under `/api/auth/*`, where the
// session layer IGNORES Bearer headers — a token can never mint tokens.
//
// TRUST SHAPE (mirrors POST /api/auth/installation): the installation a token
// binds to is validated against the viewer's LIVE accessible set from GitHub
// (`GET /user/installations`, viewer token) — never caller-asserted. The
// minted token wraps the SESSION's current encrypted GitHub credential pair
// (ciphertexts copied verbatim — plaintext is never decrypted on this path);
// from then on the api_token row refreshes independently.
//
// Every response is per-viewer state → `no-store`, error paths included.
import { randomBytes } from "node:crypto";
import { Hono } from "hono";
import {
  audit,
  AuditAction,
  AuditActorType,
  AuditMetadataKey,
  isApiTokenRowId,
  tokenAuth,
  TokenAuthErrorCode,
  type ApiTokenMetadataRow,
  type ApiTokenRowId,
} from "persistence";
import { z } from "zod";
import { sha256Hex, type AuthRouteDeps } from "./auth";
import { accessLogLayer, API_TOKEN_PREFIX, sessionLayer, type AuthzEnv } from "./authz";
import { resolveAccessibleInstallations } from "./installations";

const NO_STORE = { "cache-control": "no-store" } as const;

/** Entropy for the opaque token (bytes) — same budget as the session cookie. */
const TOKEN_BYTES = 32;
/** Default expiry when the mint names none (ADR 0016 #4: 90 days). */
const DEFAULT_EXPIRY_DAYS = 90;
/** Upper bound on a chosen expiry — 10 years; beyond that, use no-expiry. */
const MAX_EXPIRY_DAYS = 3650;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Mint body. `expiresInDays` is a whole number of days, `null` = NO expiry
 * (the adopter's call for self-host CI), omitted = the 90-day default.
 */
const mintBodySchema = z.object({
  name: z.string().min(1).max(100),
  installationId: z.union([z.string().regex(/^\d+$/), z.number().int().positive()]),
  expiresInDays: z.number().int().min(1).max(MAX_EXPIRY_DAYS).nullable().optional(),
});

/** One list/mint entry — metadata only; bigints stringified, dates ISO. */
function tokenView(row: ApiTokenMetadataRow): Record<string, string | null> {
  return {
    id: String(row.id),
    name: row.name,
    installationId: String(row.installationId),
    userLogin: row.userLogin,
    expiresAt: row.expiresAt === null ? null : row.expiresAt.toISOString(),
    lastUsedAt: row.lastUsedAt === null ? null : row.lastUsedAt.toISOString(),
    revokedAt: row.revokedAt === null ? null : row.revokedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}

/** Brand a `:id` path segment; `undefined` when it isn't a positive int. */
function parseTokenId(raw: string | undefined): ApiTokenRowId | undefined {
  if (raw === undefined || !/^\d+$/.test(raw)) {
    return undefined;
  }
  const value = BigInt(raw);
  return isApiTokenRowId(value) ? value : undefined;
}

/** Mount the token-management surface over the cookie session gate. */
export function tokensRoute(deps: AuthRouteDeps): Hono<AuthzEnv> {
  const app = new Hono<AuthzEnv>();

  app.use("/api/auth/tokens", sessionLayer(deps), accessLogLayer());
  app.use("/api/auth/tokens/:id", sessionLayer(deps), accessLogLayer());

  // Mint. The ONE response that ever carries token material.
  app.post("/api/auth/tokens", async (c) => {
    const raw: unknown = await c.req.json().catch(() => undefined);
    const parsed = mintBodySchema.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: "invalid request body" }, 400, NO_STORE);
    }
    const session = c.get("session");

    // Validate the requested installation against the LIVE accessible set —
    // never the caller's word, never the session's current binding alone
    // (same trust shape as POST /api/auth/installation).
    const resolved = await resolveAccessibleInstallations(deps, session);
    if (!resolved.ok) {
      return c.json(
        { error: resolved.error.status === 401 ? "unauthorized" : "upstream error" },
        resolved.error.status,
        NO_STORE,
      );
    }
    const { installations, session: currentSession } = resolved.value;
    const target = installations.find(
      (installation) => String(installation.installationId) === String(parsed.data.installationId),
    );
    if (target === undefined) {
      await audit(deps.handle, {
        installationId: currentSession.installationId,
        actorType: AuditActorType.REVIEWER,
        actorId: currentSession.reviewerId,
        action: AuditAction.AUTH,
        targetType: "api_token",
        metadata: { [AuditMetadataKey.DECISION]: "403", [AuditMetadataKey.KIND]: "mint" },
      });
      return c.json({ error: "forbidden" }, 403, NO_STORE);
    }

    const expiresInDays = parsed.data.expiresInDays;
    const expiresAt =
      expiresInDays === null
        ? null
        : new Date(Date.now() + (expiresInDays ?? DEFAULT_EXPIRY_DAYS) * MS_PER_DAY);

    // The opaque secret: prefix + 32 random bytes; stored only as SHA-256.
    const token = `${API_TOKEN_PREFIX}${randomBytes(TOKEN_BYTES).toString("base64url")}`;

    // Wrap the session's CURRENT encrypted GitHub pair — copied as sealed
    // ciphertext, never decrypted here. The row refreshes independently
    // afterwards (tokenAuth.refreshToken). The D9 mint audit is emitted by
    // persistence INSIDE this same transaction (codex PR2 R1).
    const minted = await tokenAuth(deps.handle).mintToken({
      installationId: target.installationId,
      userId: currentSession.reviewerId,
      ...(currentSession.reviewerLogin === null
        ? {}
        : { userLogin: currentSession.reviewerLogin }),
      name: parsed.data.name,
      tokenHash: sha256Hex(token),
      ghTokenCiphertext: currentSession.ghTokenCiphertext,
      ghRefreshTokenCiphertext: currentSession.ghRefreshTokenCiphertext,
      keyRef: currentSession.keyRef,
      expiresAt,
    });

    return c.json({ token, apiToken: tokenView(minted) }, 201, NO_STORE);
  });

  // List — the viewer's tokens across installations, metadata only (the
  // secret-bearing columns are structurally absent from the row type).
  app.get("/api/auth/tokens", async (c) => {
    const session = c.get("session");
    const rows = await tokenAuth(deps.handle).listForUser(session.reviewerId);
    return c.json({ tokens: rows.map(tokenView) }, 200, NO_STORE);
  });

  // Revoke — owner-scoped; a foreign or unknown id is an indistinguishable
  // 404. Repeat revocation is an idempotent 200 (original revoked_at kept).
  app.delete("/api/auth/tokens/:id", async (c) => {
    const tokenId = parseTokenId(c.req.param("id"));
    if (tokenId === undefined) {
      return c.json({ error: "not found" }, 404, NO_STORE);
    }
    const session = c.get("session");
    const revoked = await tokenAuth(deps.handle).revokeToken(
      session.reviewerId,
      tokenId,
      new Date(),
    );
    if (!revoked.ok) {
      // NOT_FOUND is the only expected arm on this path.
      if (revoked.error.code !== TokenAuthErrorCode.NOT_FOUND) {
        throw new Error(`unexpected revoke failure: ${revoked.error.code}`);
      }
      return c.json({ error: "not found" }, 404, NO_STORE);
    }
    await audit(deps.handle, {
      installationId: revoked.value.installationId,
      actorType: AuditActorType.REVIEWER,
      actorId: session.reviewerId,
      action: AuditAction.AUTH,
      targetType: "api_token",
      targetId: tokenId,
      metadata: { [AuditMetadataKey.DECISION]: "200", [AuditMetadataKey.KIND]: "revoke" },
    });
    return c.json({ ok: true, apiToken: tokenView(revoked.value) }, 200, NO_STORE);
  });

  return app;
}
