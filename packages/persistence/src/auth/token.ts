// The API-token auth boundary. Mirrors `session.ts`: the PRE-TENANT resolver
// for the SECOND presentation channel (CLI/agent Bearer tokens). Nothing here
// is bound to an `installation_id` — resolution by the globally UNIQUE
// `token_hash` (the opaque token, stored only as its SHA-256) is what PRODUCES
// the tenant, so it precedes `forTenant` scoping.
//
// The token row carries NO credential material — mint LINKS the minting
// session's `github_grant` row (never copies), and rotation lives in
// `grantAuth.refreshGrant`. Resolution JOINs the grant; the soft revoke keeps
// the grant reference (a revoked token stays listable), so only the
// installation-purge hard delete orphan-cleans.
//
// This surface NEVER sees token plaintext: mint takes the caller-computed
// `tokenHash`, and no operation accepts or returns token material. Mint's
// `installationId` arrives pre-validated against the viewer's LIVE accessible
// set — never caller-asserted.
import { and, desc, eq, isNull } from "drizzle-orm";
import { insertAudit } from "../stores/audit";
import { type AppDatabase, internal } from "../db/handle";
import { apiToken } from "../schema/api-token";
import { githubGrant } from "../schema/github-grant";
import {
  AuditAction,
  AuditActorType,
  type ApiTokenRowId,
  type GrantRowId,
  type InstallationId,
  type Result,
  type ReviewerId,
  type ValueOf,
  type WriteClassification,
} from "../types";
import type { GithubGrantRow } from "./grant";

export type ApiTokenRow = typeof apiToken.$inferSelect;

/**
 * The settings-facing projection: everything the mint/list/revoke surfaces
 * return. Deliberately excludes `tokenHash` (secret-adjacent) and
 * `grantId` (internal linkage) so a route serializing one of these rows
 * CANNOT leak credential material — only `resolveByHash` (the Bearer path,
 * which needs the grant to decrypt) sees the full row.
 */
export type ApiTokenMetadataRow = Omit<ApiTokenRow, "tokenHash" | "grantId">;

/** The `.select()`/`.returning()` column set backing `ApiTokenMetadataRow`. */
const metadataColumns = {
  id: apiToken.id,
  installationId: apiToken.installationId,
  userId: apiToken.userId,
  userLogin: apiToken.userLogin,
  name: apiToken.name,
  scope: apiToken.scope,
  expiresAt: apiToken.expiresAt,
  lastUsedAt: apiToken.lastUsedAt,
  revokedAt: apiToken.revokedAt,
  createdAt: apiToken.createdAt,
};

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
function livenessError(
  row: ApiTokenRow,
  now: Date,
): TokenAuthError | undefined {
  if (row.revokedAt !== null) {
    return {
      code: TokenAuthErrorCode.REVOKED,
      message: "api_token is revoked",
    };
  }
  if (row.expiresAt !== null && row.expiresAt.getTime() <= now.getTime()) {
    return {
      code: TokenAuthErrorCode.EXPIRED,
      message: "api_token is expired",
    };
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
  /** Purgeable display label. */
  readonly userLogin?: string;
  readonly name: string;
  /** Immutable for the token's life — there is no re-scope operation. */
  readonly scope: WriteClassification;
  readonly tokenHash: string;
  /** The minting session's grant — LINKED, never copied. */
  readonly grantId: GrantRowId;
  /** `null` = no expiry — the adopter's call for self-host CI. */
  readonly expiresAt: Date | null;
}

/** A resolved token with the grant it references (one JOINed query). */
export interface TokenWithGrant {
  readonly token: ApiTokenRow;
  readonly grant: GithubGrantRow;
}

export interface TokenAuth {
  /**
   * Insert a minted token row (installation binding pre-validated upstream)
   * AND its `auth` audit entry, atomically — a mint that cannot be audited
   * must not exist.
   */
  mintToken(input: TokenMintInput): Promise<ApiTokenMetadataRow>;
  /**
   * The Bearer-path resolver: hash → row (JOINed to its grant) → liveness
   * (revoked, then expired). All misses are `Result` errors so the api layer
   * maps every arm to the same hint-free 401.
   */
  resolveByHash(
    tokenHash: string,
    now: Date,
  ): Promise<Result<TokenWithGrant, TokenAuthError>>;
  /**
   * The settings-page list: ALL of a user's tokens (a person spans
   * installations) — revoked and expired included, newest first.
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
}

/**
 * Build the pre-tenant, hash-keyed token resolver over the opaque
 * `AppDatabase`. Uses the in-package `internal()` unwrap; never exposes a raw
 * query surface, and is intentionally NOT ctx-bound (see the file header).
 */
export function tokenAuth(handle: AppDatabase): TokenAuth {
  const db = internal(handle);

  return {
    async mintToken(input) {
      // ONE transaction with the audit emit: an audit failure would otherwise
      // leave a live, unaudited credential behind a 500, and the caller's
      // retry mints another.
      return db.transaction(async (tx) => {
        const rows = await tx
          .insert(apiToken)
          .values({
            installationId: input.installationId,
            userId: input.userId,
            userLogin: input.userLogin,
            name: input.name,
            scope: input.scope,
            tokenHash: input.tokenHash,
            grantId: input.grantId,
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
        .select({ token: apiToken, grant: githubGrant })
        .from(apiToken)
        .innerJoin(githubGrant, eq(apiToken.grantId, githubGrant.id))
        .where(eq(apiToken.tokenHash, tokenHash))
        .limit(1);
      const row = rows[0];
      if (row === undefined) {
        return fail(
          TokenAuthErrorCode.NOT_FOUND,
          "api_token not found for the given token hash",
        );
      }
      const dead = livenessError(row.token, now);
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
  };
}
