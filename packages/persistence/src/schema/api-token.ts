// `api_token` — the SECOND secret-bearing table after `reviewer_session`
// (ADR 0016 #4 as amended 2026-07-09, BRIEF-17): an opaque `mergebrief_...`
// Bearer token for the CLI/agents, stored ONLY as its SHA-256 hex hash,
// wrapping the same envelope-encrypted GitHub token + refresh token the
// session row wraps. A token binds exactly ONE installation, chosen at mint
// (tenancy invariant, ADR 0016 #6). Unlike `reviewer_session` it is
// long-lived and user-managed: named, listable, revocable (`revoked_at` soft
// flag so the settings list stays honest after revocation), with a nullable
// `expires_at` (no-expiry allowed) and `last_used_at` tracking. Deliberately
// NOT FK'd to `pull_request`; deleted explicitly on installation offboarding.
import { bigint, index, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import type { ApiTokenRowId, ReviewerId } from "../types";
import { stampColumns, tenantColumns } from "./columns";

export const apiToken = pgTable(
  "api_token",
  {
    ...tenantColumns<ApiTokenRowId>(),
    /** Bearer token value stored only as its SHA-256 hex — never plaintext. */
    tokenHash: text("token_hash").notNull().unique(),
    /** GitHub numeric user id of the minting user (same family as `reviewer_id`). */
    userId: bigint("user_id", { mode: "bigint" }).$type<ReviewerId>().notNull(),
    /** Purgeable display label (D1). */
    userLogin: text("user_login"),
    /** User-chosen label shown in the settings list. */
    name: text("name").notNull(),
    /** The GitHub OAuth token, encrypted at rest (same crypto seam as sessions). */
    ghTokenCiphertext: text("gh_token_ciphertext").notNull(),
    /** Rotating refresh token, encrypted at rest. */
    ghRefreshTokenCiphertext: text("gh_refresh_token_ciphertext").notNull(),
    /** Key resolved via the provider interface (env→KMS, ADR 0016 #7). */
    keyRef: text("key_ref").notNull(),
    /** Nullable: no-expiry allowed (self-host CI is the adopter's call). */
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    /** Touched (throttled, api-side) on Bearer use. */
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    /** Soft revocation: a revoked token stays listable, never resolvable. */
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    ...stampColumns(),
  },
  (table) => [
    // The settings list is per-USER (a person spans installations, D14).
    index("api_token_user_idx").on(table.userId),
    // Installation offboarding purges by tenant (codex R2), like
    // `reviewer_session`'s installation-leading index.
    index("api_token_installation_idx").on(table.installationId),
  ],
);
