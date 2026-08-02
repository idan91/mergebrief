// `reviewer_session` — the cookie-channel session adapter (D11). The
// credential itself lives on `github_grant` (D15) — this row only references
// it, so no ciphertext copy can diverge from the pair. Per
// (installation, reviewer) — deliberately NOT FK'd to `pull_request`.
// Cleared by TTL sweep, logout, and the installation-purge routine (D5);
// every delete path orphan-cleans the grant (auth/grant.ts).
import { bigint, index, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import type { GrantRowId, ReviewerId } from "../types";
import { githubGrant } from "./github-grant";
import { stampColumns, tenantColumns } from "./columns";

export const reviewerSession = pgTable(
  "reviewer_session",
  {
    ...tenantColumns(),
    /** Cookie value stored only as a hash. */
    sessionTokenHash: text("session_token_hash").notNull().unique(),
    reviewerId: bigint("reviewer_id", { mode: "bigint" })
      .$type<ReviewerId>()
      .notNull(),
    /** Purgeable display label (D1). */
    reviewerLogin: text("reviewer_login"),
    /** The GitHub credential pair lives on the grant row (D15). */
    grantId: bigint("grant_id", { mode: "bigint" })
      .$type<GrantRowId>()
      .notNull()
      .references(() => githubGrant.id),
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
