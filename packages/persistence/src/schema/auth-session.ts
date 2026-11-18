// `auth_session`, the cookie-channel session adapter. The credential
// itself lives on `github_grant`; this row only references it, so no
// ciphertext copy can diverge from the pair. Per reviewer, holding no
// installation: the reviewer's live GitHub access decides what a session
// reaches on every request. Deliberately NOT FK'd to `pull_request`. Cleared
// by TTL sweep and logout; every delete path orphan-cleans the grant
// (auth/grant.ts).
import { bigint, index, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import type { GrantRowId, ReviewerId } from "../types";
import { githubGrant } from "./github-grant";
import { idColumn, stampColumns } from "./columns";

export const authSession = pgTable(
  "auth_session",
  {
    id: idColumn(),
    /** Cookie value stored only as a hash. */
    sessionTokenHash: text("session_token_hash").notNull().unique(),
    reviewerId: bigint("reviewer_id", { mode: "bigint" })
      .$type<ReviewerId>()
      .notNull(),
    /** Purgeable display label. */
    reviewerLogin: text("reviewer_login"),
    /** The GitHub credential pair lives on the grant row. */
    grantId: bigint("grant_id", { mode: "bigint" })
      .$type<GrantRowId>()
      .notNull()
      .references(() => githubGrant.id),
    /** Short-lived; deleted on expiry/logout. */
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ...stampColumns(),
  },
  (table) => [
    index("auth_session_expires_at_idx").on(table.expiresAt),
    index("auth_session_grant_idx").on(table.grantId),
  ],
);
