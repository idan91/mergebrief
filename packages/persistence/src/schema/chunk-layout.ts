// `chunk_layout`: a brief's per-chunk row counts, the sidecar the review page
// reserves card heights from before the code lands. Keyed by the brief row;
// a brief without one renders from the page's estimate. The body is counts
// only, checked by `ChunkLayoutBodySchema` on write, so it never holds code.
import { bigint, index, pgTable, uniqueIndex } from "drizzle-orm/pg-core";
import type { BriefRowId, PullRequestRowId } from "../types";
import { brief } from "./brief";
import { artifactColumns, tenantColumns } from "./columns";
import { pullRequest } from "./pull-request";

export const chunkLayout = pgTable(
  "chunk_layout",
  {
    ...tenantColumns(),
    pullRequestId: bigint("pull_request_id", { mode: "bigint" })
      .$type<PullRequestRowId>()
      .notNull()
      .references(() => pullRequest.id, { onDelete: "cascade" }),
    briefId: bigint("brief_id", { mode: "bigint" })
      .$type<BriefRowId>()
      .notNull()
      .references(() => brief.id, { onDelete: "cascade" }),
    ...artifactColumns(),
  },
  (table) => [
    uniqueIndex("chunk_layout_brief_id_key").on(table.briefId),
    index("chunk_layout_pull_request_idx").on(table.pullRequestId),
  ],
);
