-- contracts 0.1.0
ALTER TABLE "comparison_marks" ADD COLUMN "prev_base_sha" text;--> statement-breakpoint
ALTER TABLE "comparison_marks" ADD COLUMN "new_base_sha" text;--> statement-breakpoint
-- Each side's base is the base of the newest Brief at that SHA, else the PR's current base.
UPDATE "comparison_marks" SET
  "prev_base_sha" = coalesce(
    (SELECT "brief"."base_sha" FROM "brief"
      WHERE "brief"."pull_request_id" = "comparison_marks"."pull_request_id"
        AND "brief"."head_sha" = "comparison_marks"."baseline_sha"
      ORDER BY "brief"."head_index" DESC LIMIT 1),
    (SELECT "pull_request"."base_sha" FROM "pull_request"
      WHERE "pull_request"."id" = "comparison_marks"."pull_request_id")),
  "new_base_sha" = coalesce(
    (SELECT "brief"."base_sha" FROM "brief"
      WHERE "brief"."pull_request_id" = "comparison_marks"."pull_request_id"
        AND "brief"."head_sha" = "comparison_marks"."head_sha"
      ORDER BY "brief"."head_index" DESC LIMIT 1),
    (SELECT "pull_request"."base_sha" FROM "pull_request"
      WHERE "pull_request"."id" = "comparison_marks"."pull_request_id"));--> statement-breakpoint
-- No Brief and no PR base: the next push rewrites the span, so no reader meets a row without refs.
DELETE FROM "comparison_marks" WHERE "prev_base_sha" IS NULL OR "new_base_sha" IS NULL;--> statement-breakpoint
ALTER TABLE "comparison_marks" ALTER COLUMN "prev_base_sha" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "comparison_marks" ALTER COLUMN "new_base_sha" SET NOT NULL;
