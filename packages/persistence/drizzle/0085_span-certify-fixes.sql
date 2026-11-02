-- contracts 0.1.0
-- Every statement is idempotent: a database may already hold an earlier draft of 0083 or 0084.
UPDATE "revision_narrative" SET "skipped" = true
  WHERE NOT "skipped"
    AND CASE WHEN "body" ~ '"artifactKind"\s*:\s*"revisionNarrativeSkipped"'
      THEN ("body"::jsonb ->> 'artifactKind') = 'revisionNarrativeSkipped'
      ELSE false END;--> statement-breakpoint
-- A delta older than a Brief at either SHA of its key was read on an earlier base: its marks must not certify it.
DELETE FROM "comparison_marks" WHERE EXISTS (
  SELECT 1 FROM "delta" JOIN "brief"
    ON "brief"."pull_request_id" = "delta"."pull_request_id"
    AND "brief"."head_sha" IN ("delta"."baseline_sha", "delta"."head_sha")
  WHERE "delta"."pull_request_id" = "comparison_marks"."pull_request_id"
    AND "delta"."baseline_sha" = "comparison_marks"."baseline_sha"
    AND "delta"."head_sha" = "comparison_marks"."head_sha"
    AND "brief"."created_at" > "delta"."created_at");--> statement-breakpoint
-- The same for a narrative older than a Brief at either SHA of its span.
DELETE FROM "comparison_marks" WHERE EXISTS (
  SELECT 1 FROM "revision_narrative" JOIN "brief"
    ON "brief"."pull_request_id" = "revision_narrative"."pull_request_id"
    AND "brief"."head_sha" IN ("revision_narrative"."prev_head_sha", "revision_narrative"."head_sha")
  WHERE "revision_narrative"."pull_request_id" = "comparison_marks"."pull_request_id"
    AND "revision_narrative"."prev_head_sha" = "comparison_marks"."baseline_sha"
    AND "revision_narrative"."head_sha" = "comparison_marks"."head_sha"
    AND "brief"."created_at" > "revision_narrative"."created_at");
