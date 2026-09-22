// `api_token`, the Bearer channel: stored ONLY as its SHA-256 hex hash; the
// GitHub credential pair lives on the `github_grant` row it links. It binds
// no installation (`installation_id` stays NULL; the gate resolves the
// installation from the repository) and installation offboarding leaves it:
// access ends when GitHub stops confirming it.
import { bigint, index, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import type {
  ApiTokenRowId,
  GrantRowId,
  ReviewerId,
  WriteClassification,
} from "../types";
import { githubGrant } from "./github-grant";
import { stampColumns, tenantColumns } from "./columns";

export const apiToken = pgTable(
  "api_token",
  {
    ...tenantColumns<ApiTokenRowId>(),
    tokenHash: text("token_hash").notNull().unique(),
    userId: bigint("user_id", { mode: "bigint" }).$type<ReviewerId>().notNull(),
    userLogin: text("user_login"),
    name: text("name").notNull(),
    scope: text("scope").$type<WriteClassification>().notNull(),
    grantId: bigint("grant_id", { mode: "bigint" })
      .$type<GrantRowId>()
      .notNull()
      .references(() => githubGrant.id),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    ...stampColumns(),
  },
  (table) => [
    index("api_token_user_idx").on(table.userId),
    index("api_token_installation_idx").on(table.installationId),
  ],
);
