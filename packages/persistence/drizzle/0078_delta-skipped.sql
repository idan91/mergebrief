ALTER TABLE "delta" ADD COLUMN "skipped" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- A skip record written before the column takes its flag from its body; a
-- body Postgres cannot read as one JSON object stays a Delta Brief.
UPDATE "delta" SET "skipped" = true
WHERE CASE
  WHEN "body" IS JSON OBJECT WITH UNIQUE KEYS
    THEN coalesce(("body"::json ->> 'artifactKind') = 'deltaSkipped', false)
  ELSE false
END;
