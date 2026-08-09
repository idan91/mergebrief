// `github_grant` — ONE row per GitHub user-to-server authorization, the ONLY
// holder of the encrypted credential pair. `reviewer_session` and `api_token`
// reference it by FK instead of carrying ciphertext copies: GitHub refresh
// tokens are single-use, so two rows holding copies of one pair race each
// other's rotation and the loser is stranded — one physical copy makes that
// unrepresentable.
//
// Deliberately NOT tenant-scoped (like `audit_log` and `user_settings`): the
// credential belongs to a GitHub *user* and spans installations; the
// installation binding stays on the referencing rows.
// Lifecycle: dies with its last referent, deleted in the same transaction
// (see `auth/grant.ts`) — never swept independently.
import { bigint, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import type { GrantRowId } from "../types";
import { stampColumns } from "./columns";

export const githubGrant = pgTable("github_grant", {
  id: bigint("id", { mode: "bigint" })
    .$type<GrantRowId>()
    .generatedAlwaysAsIdentity()
    .primaryKey(),
  /** The GitHub OAuth access token, encrypted at rest. */
  ghTokenCiphertext: text("gh_token_ciphertext").notNull(),
  /** Rotating single-use refresh token, encrypted at rest. */
  ghRefreshTokenCiphertext: text("gh_refresh_token_ciphertext").notNull(),
  /** Names the key that sealed the pair; resolved via the key provider. */
  keyRef: text("key_ref").notNull(),
  /** The pair's outer bound (~6mo rotating refresh token), moved on rotation. */
  refreshExpiresAt: timestamp("refresh_expires_at", {
    withTimezone: true,
  }).notNull(),
  /** Set explicitly by `refreshGrant` on every rotation. */
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  ...stampColumns(),
});
