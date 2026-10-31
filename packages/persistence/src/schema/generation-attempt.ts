// `generation_attempt`: one row per paid run, the daily cap's counter. No
// foreign key to `generation`: purging a PR must not erase the day's spend.
// Rows hold ids, counts and timestamps only.
import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  index,
  integer,
  pgTable,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { tenantColumns } from "./columns";

export const generationAttempt = pgTable(
  "generation_attempt",
  {
    ...tenantColumns(),
    runId: uuid("run_id").notNull().unique("generation_attempt_run_id_key"),
    /** Loose numeric ref to the `generation` row, deliberately not an FK. */
    generationId: bigint("generation_id", { mode: "bigint" }).notNull(),
    /** The cap's day key: a unit claim after midnight moves it onto the claim's UTC day. */
    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    /** When the attempt was recorded; nothing moves it, so it is the run's start to show. */
    recordedAt: timestamp("recorded_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    /** The cap units the run paid for: 1 for its claim, plus every later claim. */
    units: integer("units").notNull().default(1),
    partsDone: integer("parts_done").notNull().default(0),
    /** The detail calls the run's grouping planned, stored and fresh alike; null before the grouping call. */
    partsTotal: integer("parts_total"),
  },
  (table) => [
    index("generation_attempt_started_at_idx").on(table.startedAt),
    check("generation_attempt_units_check", sql`${table.units} >= 1`),
    check("generation_attempt_parts_done_check", sql`${table.partsDone} >= 0`),
    check(
      "generation_attempt_parts_total_check",
      sql`${table.partsTotal} is null or ${table.partsTotal} >= 0`,
    ),
  ],
);
