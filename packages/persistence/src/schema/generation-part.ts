// `generation_part`: a multi-call run's finished detail calls, kept between
// calls so a retry resumes instead of paying for them again. Keyed by the
// span the brief will cover plus the part's key; the body is chunks only,
// checked by `GenerationPartBodySchema` on write, so it never holds code.
import {
  bigint,
  check,
  index,
  pgTable,
  text,
  unique,
} from "drizzle-orm/pg-core";
import type { PullRequestRowId } from "../types";
import { isJsonObject, matchesPattern } from "./checks";
import { artifactColumns, tenantColumns } from "./columns";
import { pullRequest } from "./pull-request";

/** A part's key: lowercase tokens joined by `:`, such as `detail:3` or `detail:3:1`. */
export const GENERATION_PART_KEY_PATTERN = /^[a-z][a-z0-9]*(:[a-z0-9]+)*$/;

export const generationPart = pgTable(
  "generation_part",
  {
    ...tenantColumns(),
    pullRequestId: bigint("pull_request_id", { mode: "bigint" })
      .$type<PullRequestRowId>()
      .notNull()
      .references(() => pullRequest.id, { onDelete: "cascade" }),
    /** The PR base the brief spans from. */
    baseSha: text("base_sha").notNull(),
    headSha: text("head_sha").notNull(),
    partKey: text("part_key").notNull(),
    ...artifactColumns(),
  },
  (table) => [
    unique("generation_part_natural_key")
      .on(
        table.installationId,
        table.pullRequestId,
        table.baseSha,
        table.headSha,
        table.partKey,
      )
      .nullsNotDistinct(),
    index("generation_part_pull_request_idx").on(table.pullRequestId),
    check("generation_part_body_check", isJsonObject(table.body)),
    check(
      "generation_part_part_key_check",
      matchesPattern(table.partKey, GENERATION_PART_KEY_PATTERN),
    ),
  ],
);
