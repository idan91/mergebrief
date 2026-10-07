// `generation_attempt`: one row per paid run, the daily cap's counter. No
// foreign key to `generation`: purging a PR must not erase the day's spend.
// Rows hold ids and a timestamp only.
import { bigint, index, pgTable, timestamp, uuid } from "drizzle-orm/pg-core";
import { tenantColumns } from "./columns";

export const generationAttempt = pgTable(
  "generation_attempt",
  {
    ...tenantColumns(),
    runId: uuid("run_id").notNull().unique("generation_attempt_run_id_key"),
    /** Loose numeric ref to the `generation` row, deliberately not an FK. */
    generationId: bigint("generation_id", { mode: "bigint" }).notNull(),
    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("generation_attempt_started_at_idx").on(table.startedAt)],
);
