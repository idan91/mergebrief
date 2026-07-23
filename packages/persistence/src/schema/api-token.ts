// `api_token` — the Bearer presentation channel (ADR 0016 #4 as amended,
// BRIEF-17): an opaque `mergebrief_...` Bearer token for the CLI/agents,
// stored ONLY as its SHA-256 hex hash. The GitHub credential pair lives on
// the `github_grant` row it references (D15, BRIEF-40) — mint LINKS the
// session's grant, never copies. A token binds exactly ONE installation, chosen at mint
// (tenancy invariant, ADR 0016 #6). Unlike `reviewer_session` it is
// long-lived and user-managed: named, listable, revocable (`revoked_at` soft
// flag so the settings list stays honest after revocation), with a nullable
// `expires_at` (no-expiry allowed) and `last_used_at` tracking. Deliberately
// NOT FK'd to `pull_request`; deleted explicitly on installation offboarding.
import { bigint, index, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import type { ApiTokenRowId, GrantRowId, ReviewerId } from "../types";
import { githubGrant } from "./github-grant";
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
    /** The GitHub credential pair lives on the grant row (D15). */
    grantId: bigint("grant_id", { mode: "bigint" })
      .$type<GrantRowId>()
      .notNull()
      .references(() => githubGrant.id),
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
