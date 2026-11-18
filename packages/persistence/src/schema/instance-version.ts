// `instance_version`: one row, the version that last booted and applied the
// schema, and when. The boot boundary writes it after migrating; the `id`
// check pins the table to a single row.
import { sql } from "drizzle-orm";
import { boolean, check, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const instanceVersion = pgTable(
  "instance_version",
  {
    id: boolean("id").primaryKey().default(true),
    version: text("version").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [check("instance_version_single_row", sql`${table.id}`)],
);
