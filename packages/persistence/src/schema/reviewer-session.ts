// `reviewer_session` — the ONE secret-bearing table (D11): the self-host
// session adapter holding the encrypted GitHub OAuth token. Per
// (installation, reviewer) — deliberately NOT FK'd to `pull_request`.
// Cleared by TTL sweep, logout, and the installation-purge routine (D5).
import { bigint, index, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import type { ReviewerId } from "../types.js";
import { stampColumns, tenantColumns } from "./columns.js";

export const reviewerSession = pgTable(
  "reviewer_session",
  {
    ...tenantColumns(),
    /** Cookie value stored only as a hash. */
    sessionTokenHash: text("session_token_hash").notNull().unique(),
    reviewerId: bigint("reviewer_id", { mode: "bigint" }).$type<ReviewerId>().notNull(),
    /** Purgeable display label (D1). */
    reviewerLogin: text("reviewer_login"),
    /** The GitHub OAuth token, encrypted at rest. */
    ghTokenCiphertext: text("gh_token_ciphertext").notNull(),
    /** Key resolved via the provider interface (env→KMS, ADR 0016 #7). */
    keyRef: text("key_ref").notNull(),
    /** Short-lived; deleted on expiry/logout. */
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ...stampColumns(),
  },
  (table) => [
    index("reviewer_session_installation_reviewer_idx").on(
      table.installationId,
      table.reviewerId,
    ),
  ],
);
