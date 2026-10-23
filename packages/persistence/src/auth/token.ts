// The API-token auth boundary, the PRE-TENANT resolver for the Bearer
// channel: resolution by the globally UNIQUE `token_hash` precedes any
// scoping. The row carries NO credential material and binds no installation;
// mint LINKS the minting session's `github_grant` row, and the soft revoke
// keeps that reference so a revoked token stays listable. This surface never
// sees token plaintext: mint takes the caller-computed `tokenHash`.
import { and, desc, eq, isNull } from "drizzle-orm";
import { traceStore } from "../stores/trace-store";
import { insertAudit } from "../stores/audit";
import { type AppDatabase, type AppDrizzle, internal } from "../db/handle";
import { apiToken } from "../schema/api-token";
import { authSession } from "../schema/auth-session";
import { githubGrant } from "../schema/github-grant";
import {
  AuditOutcomes,
  AuditActorTypes,
  type ApiTokenRowId,
  type GrantRowId,
  type ReviewerId,
} from "../types";
import { PullRequestSources, type AccessLevel } from "types";
import type { Result } from "types/utils";
import { TokenMintErrorCodes, type TokenMintErrorCode } from "./types";
import {
  type GithubGrantRow,
  type OrphanedGrant,
  deleteOrphanedGrants,
} from "./grant";

// The issuance row this store writes INSIDE the mint transaction, a mint that
// commits always has a ledger entry. Named apart from the `mint-token`
// descriptor id the request path records, so neither double-counts the other.
const AUDIT_OPERATION_MINT = "issue-api-token";

export type ApiTokenRow = typeof apiToken.$inferSelect;

export interface TokenMintError {
  readonly code: TokenMintErrorCode;
  readonly message: string;
}

/**
 * The settings-facing projection: everything the mint/list/revoke surfaces
 * return. Deliberately excludes `tokenHash` (secret-adjacent) and
 * `grantId` (internal linkage) so a route serializing one of these rows
 * CANNOT leak credential material, only `resolveByHash` (the Bearer path,
 * which needs the grant to decrypt) sees the full row.
 */
export type ApiTokenMetadataRow = Omit<ApiTokenRow, "tokenHash" | "grantId">;

/** A revoked token's metadata, and its grant when no live referent remains. */
export interface RevokedToken {
  readonly token: ApiTokenMetadataRow;
  readonly orphanedGrants: readonly OrphanedGrant[];
}

/** The `.select()`/`.returning()` column set backing `ApiTokenMetadataRow`. */
const metadataColumns = {
  id: apiToken.id,
  userId: apiToken.userId,
  userLogin: apiToken.userLogin,
  name: apiToken.name,
  scope: apiToken.scope,
  expiresAt: apiToken.expiresAt,
  lastUsedAt: apiToken.lastUsedAt,
  revokedAt: apiToken.revokedAt,
  createdAt: apiToken.createdAt,
};

/**
 * A token is live until revoked or expired. Expiry is exclusive of the
 * instant: a token is dead once `expires_at <= now`.
 */
function isTokenLive(row: ApiTokenRow, now: Date): boolean {
  if (row.revokedAt !== null) {
    return false;
  }
  if (row.expiresAt === null) {
    return true;
  }
  return row.expiresAt.getTime() > now.getTime();
}

// ---------------------------------------------------------------------------
// The surface.
// ---------------------------------------------------------------------------

/** Everything a mint persists. `tokenHash` only, plaintext never enters. */
export interface TokenMintInput {
  readonly userId: ReviewerId;
  /** Purgeable display label. */
  readonly userLogin?: string;
  readonly name: string;
  /** Immutable for the token's life, there is no re-scope operation. */
  readonly scope: AccessLevel;
  readonly tokenHash: string;
  /** The minting session's grant. LINKED, never copied. */
  readonly grantId: GrantRowId;
  /** `null` = no expiry, the adopter's call for self-host CI. */
  readonly expiresAt: Date | null;
}

/** A resolved token with the grant it references (one JOINed query). */
export interface TokenWithGrant {
  readonly token: ApiTokenRow;
  readonly grant: GithubGrantRow;
}

export interface TokenAuth {
  /**
   * Insert a minted token row AND its `auth` audit entry, atomically, a
   * mint that cannot be audited must not exist.
   */
  mintToken(input: TokenMintInput): Promise<ApiTokenMetadataRow>;
  /**
   * The browser mint: `mintToken` behind a lock on the minting session, so a
   * concurrent logout cannot orphan the grant under a fresh token. A session
   * gone by the time the lock is taken is `SESSION_GONE`, nothing inserted.
   */
  mintTokenFromSession(
    sessionTokenHash: string,
    input: TokenMintInput,
  ): Promise<Result<ApiTokenMetadataRow, TokenMintError>>;
  /**
   * The Bearer-path resolver: hash → row (JOINed to its grant) → liveness.
   * An unknown, revoked or expired token is `undefined`, one answer, so the
   * api layer cannot tell the cases apart on the wire. A token whose grant
   * the sweep deleted joins nothing and answers the same.
   */
  resolveByHash(
    tokenHash: string,
    now: Date,
  ): Promise<TokenWithGrant | undefined>;
  /**
   * The settings-page list: ALL of a user's tokens (a person spans
   * installations), revoked and expired included, newest first.
   * Metadata rows only, credential material is structurally absent.
   */
  listForUser(userId: ReviewerId): Promise<ApiTokenMetadataRow[]>;
  /**
   * Owner-scoped soft revoke: sets `revoked_at = now` once; idempotent (a
   * second revoke returns the row with its ORIGINAL `revoked_at`). The
   * UPDATE is gated by `(user_id, id)`, so a user can only revoke their own
   * tokens; someone else's id and an absent one are both `undefined`. The
   * first revoke also settles the token's grant when no session or live token
   * uses it any more, and returns it for a GitHub revoke after commit.
   */
  revokeToken(
    userId: ReviewerId,
    tokenId: ApiTokenRowId,
    now: Date,
  ): Promise<RevokedToken | undefined>;
  /**
   * Stamp `last_used_at` by hash (the api layer throttles, this is
   * unconditional). Returns rows touched (0 for an unknown hash).
   */
  touchLastUsed(tokenHash: string, now: Date): Promise<number>;
}

async function insertMintedToken(
  tx: AppDrizzle,
  input: TokenMintInput,
): Promise<ApiTokenMetadataRow> {
  const rows = await tx
    .insert(apiToken)
    .values({
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
    installationId: null,
    source: PullRequestSources.URL,
    actorType: AuditActorTypes.REVIEWER,
    actorId: input.userId,
    operation: AUDIT_OPERATION_MINT,
    outcome: AuditOutcomes.OK,
    targetType: "api_token",
    targetId: row.id,
    metadata: { decision: "200", kind: "mint" },
  });
  return row;
}

/**
 * Build the pre-tenant, hash-keyed token resolver over the opaque
 * `AppDatabase`. Uses the in-package `internal()` unwrap; never exposes a raw
 * query surface, and is intentionally NOT ctx-bound (see the file header).
 */
export function createTokenAuth(handle: AppDatabase): TokenAuth {
  const db = internal(handle);

  return traceStore("tokenAuth", {
    async mintToken(input) {
      // ONE transaction with the audit emit: an audit failure would otherwise
      // leave a live, unaudited credential behind a 500, and the caller's
      // retry mints another.
      return db.transaction(async (tx) => insertMintedToken(tx, input));
    },

    async mintTokenFromSession(sessionTokenHash, input) {
      return db.transaction(async (tx) => {
        // FOR SHARE first (sessions, then tokens, then the grant): a logout
        // deleting this session waits for the mint and then sees its token,
        // or committed first and the mint is refused.
        const held = await tx
          .select({ id: authSession.id })
          .from(authSession)
          .where(
            and(
              eq(authSession.sessionTokenHash, sessionTokenHash),
              eq(authSession.grantId, input.grantId),
            ),
          )
          .for("share");
        if (held.length === 0) {
          return {
            ok: false,
            error: {
              code: TokenMintErrorCodes.SESSION_GONE,
              message: "the minting session no longer exists",
            },
          };
        }
        return { ok: true, value: await insertMintedToken(tx, input) };
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
        return undefined;
      }
      if (!isTokenLive(row.token, now)) {
        return undefined;
      }
      return row;
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
          .returning({ ...metadataColumns, grantId: apiToken.grantId });
        const updatedRow = updated[0];
        if (updatedRow !== undefined) {
          const { grantId, ...token } = updatedRow;
          // An expired token's grant may already be swept: nothing to settle.
          const grantIds = grantId === null ? [] : [grantId];
          const orphanedGrants = await deleteOrphanedGrants(tx, grantIds);
          return { token, orphanedGrants };
        }
        // Second arm: distinguish already-revoked (idempotent success,
        // original `revoked_at` intact) from not-owned or absent.
        const existing = await tx
          .select(metadataColumns)
          .from(apiToken)
          .where(and(eq(apiToken.userId, userId), eq(apiToken.id, tokenId)))
          .limit(1);
        const existingRow = existing[0];
        return existingRow === undefined
          ? undefined
          : { token: existingRow, orphanedGrants: [] };
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
  });
}
