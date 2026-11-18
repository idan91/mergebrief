// `api_token`, the Bearer channel: stored ONLY as its SHA-256 hex hash; the
// GitHub credential pair lives on the `github_grant` row it links. It holds
// no installation (the gate resolves the installation from the repository)
// and installation offboarding leaves it: access ends when GitHub stops
// confirming it. A revoked or expired row outlives its grant (`grant_id` goes
// NULL) for the settings list, until the sweep deletes it 30 days on.
import {
  bigint,
  check,
  index,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import type { ApiTokenRowId, GrantRowId, ReviewerId } from "../types";
import { githubGrant } from "./github-grant";
import { isOneOf } from "./checks";
import { idColumn, stampColumns } from "./columns";
import { AccessLevels, type AccessLevel } from "types/access-levels";

const API_TOKEN_SCOPES = Object.values(AccessLevels);

export const apiToken = pgTable(
  "api_token",
  {
    id: idColumn<ApiTokenRowId>(),
    tokenHash: text("token_hash").notNull().unique(),
    userId: bigint("user_id", { mode: "bigint" }).$type<ReviewerId>().notNull(),
    userLogin: text("user_login"),
    name: text("name").notNull(),
    scope: text("scope").$type<AccessLevel>().notNull(),
    grantId: bigint("grant_id", { mode: "bigint" })
      .$type<GrantRowId>()
      .references(() => githubGrant.id, { onDelete: "set null" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    ...stampColumns(),
  },
  (table) => [
    index("api_token_user_idx").on(table.userId),
    index("api_token_grant_idx").on(table.grantId),
    check("api_token_scope_check", isOneOf(table.scope, API_TOKEN_SCOPES)),
  ],
);
