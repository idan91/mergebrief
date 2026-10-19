ALTER TABLE "generation" ADD COLUMN "triggered_at" timestamp with time zone DEFAULT to_timestamp(0) NOT NULL;--> statement-breakpoint
-- A row from before the column takes its last write as its last trigger. A
-- superseded row's last write is the sweep that retired it, later than the
-- current head's, so it maps into the column's first hour, below every live
-- row, keeping its order among the superseded.
UPDATE "generation" SET "triggered_at" = CASE
  WHEN "status" = 'superseded'
    THEN to_timestamp(extract(epoch FROM "updated_at") / 1000000)
  ELSE "updated_at"
END;
