// `github_grant`: one row per GitHub user-to-server authorization, the only
// holder of its sealed credential pair. Sessions and API tokens reference it,
// because GitHub refresh tokens are single-use and two copies would race each
// other's rotation. It belongs to a GitHub user, not an installation, and dies
// with its last referent in the same transaction (`auth/grant.ts`).
import { bigint, index, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import type { GrantRowId, ReviewerId } from "../types";
import { stampColumns } from "./columns";

export const githubGrant = pgTable(
  "github_grant",
  {
    id: bigint("id", { mode: "bigint" })
      .$type<GrantRowId>()
      .generatedAlwaysAsIdentity()
      .primaryKey(),
    userId: bigint("user_id", { mode: "bigint" }).$type<ReviewerId>().notNull(),
    ghTokenCiphertext: text("gh_token_ciphertext").notNull(),
    ghRefreshTokenCiphertext: text("gh_refresh_token_ciphertext").notNull(),
    /** Names the key that sealed the pair; resolved via the key provider. */
    keyRef: text("key_ref").notNull(),
    /** The rotating refresh token's own bound, moved on every rotation. */
    refreshExpiresAt: timestamp("refresh_expires_at", {
      withTimezone: true,
    }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    ...stampColumns(),
  },
  (table) => [index("github_grant_user_idx").on(table.userId)],
);
