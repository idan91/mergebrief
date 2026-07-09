// The API-token auth seam (BRIEF-17 PR 1 — ADR 0016 #4 as amended 2026-07-09).
// Mirrors `session.ts`: this is the PRE-TENANT resolver for the SECOND
// presentation channel (CLI/agent Bearer tokens over the same session
// machinery). Nothing here is bound to an `installation_id` — resolution by
// the globally UNIQUE `token_hash` (the opaque `mergebrief_...` token, stored
// only as its SHA-256) is what PRODUCES the tenant, so it precedes `forTenant`
// scoping, the same trust shape as `sessionAuth`.
//
// This surface NEVER sees token plaintext: mint takes the caller-computed
// `tokenHash`, and no operation accepts or returns token material. Mint's
// `installationId` arrives pre-validated — the mint route derives it from the
// viewer's cookie session and validates it against their LIVE accessible set
// (never caller-asserted; ADR 0016 #4) before calling this seam.
//
// The write paths stay tenant-safe the way `session.ts`'s do: every UPDATE is
// scoped by the locked/resolved row's own columns (`installation_id` + `id`,
// or `user_id` + `id` for the owner-scoped revoke), never by an unscoped
// caller argument.
import { and, desc, eq, isNull } from "drizzle-orm";
import { insertAudit } from "./audit";
import { type AppDatabase, internal } from "./db";
import { apiToken } from "./schema/api-token";
import {
  AuditAction,
  AuditActorType,
  type ApiTokenRowId,
  type InstallationId,
  type Result,
  type ReviewerId,
  type ValueOf,
} from "./types";

export type ApiTokenRow = typeof apiToken.$inferSelect;

/**
 * The settings-facing projection (codex R1): everything the mint/list/revoke
 * surfaces return. Deliberately excludes the secret-bearing columns
 * (`tokenHash`, both ciphertexts, `keyRef`) so a route serializing one of
 * these rows CANNOT leak credential material — only `resolveByHash` and
 * `refreshToken` (the Bearer path, which needs to decrypt) see the full row.
 */
export type ApiTokenMetadataRow = Omit<
  ApiTokenRow,
  "tokenHash" | "ghTokenCiphertext" | "ghRefreshTokenCiphertext" | "keyRef"
>;

/** The `.select()`/`.returning()` column set backing `ApiTokenMetadataRow`. */
const metadataColumns = {
  id: apiToken.id,
  installationId: apiToken.installationId,
  userId: apiToken.userId,
  userLogin: apiToken.userLogin,
  name: apiToken.name,
  expiresAt: apiToken.expiresAt,
  lastUsedAt: apiToken.lastUsedAt,
  revokedAt: apiToken.revokedAt,
  createdAt: apiToken.createdAt,
};

// ---------------------------------------------------------------------------
// Refresh patch + rejection — compatible with the api layer's `spendRefresh`
// machinery. Unlike `SessionRefreshPatch` there is deliberately NO
// `expiresAt`: a session's expiry tracks its ~6mo GitHub refresh token, but a
// token's expiry is chosen at mint (90d default / no-expiry) and must never
// move when the wrapped GitHub credentials rotate.
// ---------------------------------------------------------------------------

/** New encrypted-credential columns to persist after a successful refresh. */
export interface TokenRefreshPatch {
  readonly ghTokenCiphertext: string;
  readonly ghRefreshTokenCiphertext: string;
  readonly keyRef: string;
}

/**
 * The caller's refresh failed (decrypt / GitHub rotation / re-encrypt). The
 * `reason` is opaque to persistence — it just signals "do not UPDATE".
 */
export interface TokenRefreshRejection {
  readonly reason: string;
}

// ---------------------------------------------------------------------------
// Errors — expected failures. Programmer errors still `throw`. The api layer
// collapses ALL of these to a hint-free 401 on the Bearer path.
// ---------------------------------------------------------------------------

export const TokenAuthErrorCode = {
  /** No token row for the given hash, or an owner-scoped op missed. */
  NOT_FOUND: "not-found",
  /** The row exists but is past its mint-chosen `expires_at`. */
  EXPIRED: "expired",
  /** The row exists but was revoked (`revoked_at` set). */
  REVOKED: "revoked",
  /** The caller's `refresh` callback rejected; the row is left untouched. */
  REFRESH_REJECTED: "refresh-rejected",
} as const;
export type TokenAuthErrorCode = ValueOf<typeof TokenAuthErrorCode>;

export interface TokenAuthError {
  readonly code: TokenAuthErrorCode;
  readonly message: string;
}

function fail(
  code: TokenAuthErrorCode,
  message: string,
): Result<never, TokenAuthError> {
  return { ok: false, error: { code, message } };
}

/**
 * Liveness check shared by resolution and refresh: revoked wins over expired
 * (a revoked token must read as revoked even after its expiry passes).
 * Expiry is exclusive of the instant: a token is dead once `expires_at <= now`.
 */
function livenessError(row: ApiTokenRow, now: Date): TokenAuthError | undefined {
  if (row.revokedAt !== null) {
    return { code: TokenAuthErrorCode.REVOKED, message: "api_token is revoked" };
  }
  if (row.expiresAt !== null && row.expiresAt.getTime() <= now.getTime()) {
    return { code: TokenAuthErrorCode.EXPIRED, message: "api_token is expired" };
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// The surface.
// ---------------------------------------------------------------------------

/** Everything a mint persists. `tokenHash` only — plaintext never enters. */
export interface TokenMintInput {
  readonly installationId: InstallationId;
  readonly userId: ReviewerId;
  /** Purgeable display label (D1). */
  readonly userLogin?: string;
  readonly name: string;
  readonly tokenHash: string;
  readonly ghTokenCiphertext: string;
  readonly ghRefreshTokenCiphertext: string;
  readonly keyRef: string;
  /** `null` = no expiry (ADR 0016 #4: the adopter's call for self-host CI). */
  readonly expiresAt: Date | null;
}

export interface TokenAuth {
  /**
   * Insert a minted token row (installation binding pre-validated upstream)
   * AND its D9 `auth` audit entry, atomically — a mint that cannot be
   * audited must not exist.
   */
  mintToken(input: TokenMintInput): Promise<ApiTokenMetadataRow>;
  /**
   * The Bearer-path resolver: hash → row → liveness (revoked, then expired).
   * All misses are `Result` errors so the api layer maps every arm to the
   * same hint-free 401.
   */
  resolveByHash(tokenHash: string, now: Date): Promise<Result<ApiTokenRow, TokenAuthError>>;
  /**
   * The settings-page list: ALL of a user's tokens (a person spans
   * installations, D14) — revoked and expired included, newest first.
   * Metadata rows only — credential material is structurally absent.
   */
  listForUser(userId: ReviewerId): Promise<ApiTokenMetadataRow[]>;
  /**
   * Owner-scoped soft revoke: sets `revoked_at = now` once; idempotent (a
   * second revoke returns the row with its ORIGINAL `revoked_at`). The
   * UPDATE is gated by `(user_id, id)`, so a user can only revoke their own
   * tokens — someone else's id is an indistinguishable `NOT_FOUND`.
   */
  revokeToken(
    userId: ReviewerId,
    tokenId: ApiTokenRowId,
    now: Date,
  ): Promise<Result<ApiTokenMetadataRow, TokenAuthError>>;
  /**
   * Stamp `last_used_at` by hash (the api layer throttles — this is
   * unconditional). Returns rows touched (0 for an unknown hash).
   */
  touchLastUsed(tokenHash: string, now: Date): Promise<number>;
  /**
   * Serialized, single-use-refresh-token-safe rotation — the exact D11 shape
   * `sessionAuth.refreshSession` implements (see its doc for the full
   * rationale). ONE transaction: `SELECT … FOR UPDATE` by hash, then:
   *   - absent row → `NOT_FOUND`;
   *   - revoked/expired row → `REVOKED`/`EXPIRED` WITHOUT calling `refresh`
   *     (a dead token's credentials are never rotated — token guard, no
   *     session analogue);
   *   - compare-and-swap: `seenTokenCiphertext` ≠ the locked row's → another
   *     request already rotated; return AS-IS without calling `refresh`;
   *   - otherwise `refresh(lockedRow)` inside the lock; on ok apply the patch
   *     (ciphertexts + keyRef ONLY — `expires_at` never moves) scoped by the
   *     row's own `installation_id` + `id`; on rejection return
   *     `REFRESH_REJECTED` with no write.
   */
  refreshToken(
    tokenHash: string,
    seenTokenCiphertext: string,
    now: Date,
    refresh: (
      locked: ApiTokenRow,
    ) => Promise<Result<TokenRefreshPatch, TokenRefreshRejection>>,
  ): Promise<Result<ApiTokenRow, TokenAuthError>>;
}

/**
 * Build the pre-tenant, hash-keyed token resolver over the opaque
 * `AppDatabase`. Uses the in-package `internal()` unwrap; never exposes a raw
 * query surface (D2b), and is intentionally NOT ctx-bound (see the file
 * header).
 */
export function tokenAuth(handle: AppDatabase): TokenAuth {
  const db = internal(handle);

  return {
    async mintToken(input) {
      // ONE transaction with the D9 audit emit (codex PR2 R1): a mint that
      // cannot be audited must not exist — otherwise an audit failure leaves
      // a live, unaudited credential behind a 500, and the caller's retry
      // mints another.
      return db.transaction(async (tx) => {
        const rows = await tx
          .insert(apiToken)
          .values({
            installationId: input.installationId,
            userId: input.userId,
            userLogin: input.userLogin,
            name: input.name,
            tokenHash: input.tokenHash,
            ghTokenCiphertext: input.ghTokenCiphertext,
            ghRefreshTokenCiphertext: input.ghRefreshTokenCiphertext,
            keyRef: input.keyRef,
            expiresAt: input.expiresAt,
          })
          .returning(metadataColumns);
        const row = rows[0];
        if (row === undefined) {
          throw new Error("api_token insert returned no row");
        }
        await insertAudit(tx, {
          installationId: input.installationId,
          actorType: AuditActorType.REVIEWER,
          actorId: input.userId,
          action: AuditAction.AUTH,
          targetType: "api_token",
          targetId: row.id,
          metadata: { decision: "200", kind: "mint" },
        });
        return row;
      });
    },

    async resolveByHash(tokenHash, now) {
      const rows = await db
        .select()
        .from(apiToken)
        .where(eq(apiToken.tokenHash, tokenHash))
        .limit(1);
      const row = rows[0];
      if (row === undefined) {
        return fail(
          TokenAuthErrorCode.NOT_FOUND,
          "api_token not found for the given token hash",
        );
      }
      const dead = livenessError(row, now);
      if (dead !== undefined) {
        return { ok: false, error: dead };
      }
      return { ok: true, value: row };
    },

    async listForUser(userId) {
      return db
        .select(metadataColumns)
        .from(apiToken)
        .where(eq(apiToken.userId, userId))
        .orderBy(desc(apiToken.createdAt), desc(apiToken.id));
    },

    async revokeToken(userId, tokenId, now) {
      return db.transaction(async (tx) => {
        // First arm: revoke a live row. `revoked_at IS NULL` in the predicate
        // keeps the original timestamp on a repeat revoke.
        const updated = await tx
          .update(apiToken)
          .set({ revokedAt: now })
          .where(
            and(
              eq(apiToken.userId, userId),
              eq(apiToken.id, tokenId),
              isNull(apiToken.revokedAt),
            ),
          )
          .returning(metadataColumns);
        const updatedRow = updated[0];
        if (updatedRow !== undefined) {
          return { ok: true, value: updatedRow };
        }
        // Second arm: distinguish already-revoked (idempotent success,
        // original `revoked_at` intact) from not-owned/absent (`NOT_FOUND`).
        const existing = await tx
          .select(metadataColumns)
          .from(apiToken)
          .where(and(eq(apiToken.userId, userId), eq(apiToken.id, tokenId)))
          .limit(1);
        const row = existing[0];
        if (row === undefined) {
          return fail(
            TokenAuthErrorCode.NOT_FOUND,
            `api_token ${tokenId} not found for the given user`,
          );
        }
        return { ok: true, value: row };
      });
    },

    async touchLastUsed(tokenHash, now) {
      const rows = await db
        .update(apiToken)
        .set({ lastUsedAt: now })
        .where(eq(apiToken.tokenHash, tokenHash))
        .returning({ id: apiToken.id });
      return rows.length;
    },

    async refreshToken(tokenHash, seenTokenCiphertext, now, refresh) {
      return db.transaction(async (tx) => {
        // FOR UPDATE: serialize concurrent refreshes of THIS token (GitHub
        // refresh tokens are single-use; a lost race burns the token — D11).
        const locked = await tx
          .select()
          .from(apiToken)
          .where(eq(apiToken.tokenHash, tokenHash))
          .for("update")
          .limit(1);
        const row = locked[0];
        if (row === undefined) {
          return fail(
            TokenAuthErrorCode.NOT_FOUND,
            "api_token not found for the given token hash",
          );
        }

        // Never rotate a dead token's credentials.
        const dead = livenessError(row, now);
        if (dead !== undefined) {
          return { ok: false, error: dead };
        }

        // Compare-and-swap: already rotated by another request while we
        // waited for the lock → return AS-IS, no second exchange (D11).
        if (row.ghTokenCiphertext !== seenTokenCiphertext) {
          return { ok: true, value: row };
        }

        const patch = await refresh(row);
        if (!patch.ok) {
          // The tx commits cleanly with NO write — the caller 401s.
          return fail(
            TokenAuthErrorCode.REFRESH_REJECTED,
            "api_token refresh was rejected by the caller",
          );
        }

        const updated = await tx
          .update(apiToken)
          .set({
            ghTokenCiphertext: patch.value.ghTokenCiphertext,
            ghRefreshTokenCiphertext: patch.value.ghRefreshTokenCiphertext,
            keyRef: patch.value.keyRef,
          })
          .where(
            and(
              eq(apiToken.installationId, row.installationId),
              eq(apiToken.id, row.id),
            ),
          )
          .returning();
        const updatedRow = updated[0];
        if (updatedRow === undefined) {
          throw new Error("api_token refresh update returned no row");
        }
        return { ok: true, value: updatedRow };
      });
    },
  };
}
