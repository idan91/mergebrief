ALTER TABLE "brief" DROP CONSTRAINT "brief_natural_key";--> statement-breakpoint
ALTER TABLE "checkpoint" DROP CONSTRAINT "checkpoint_natural_key";--> statement-breakpoint
ALTER TABLE "comparison_marks" DROP CONSTRAINT "comparison_marks_natural_key";--> statement-breakpoint
ALTER TABLE "delta" DROP CONSTRAINT "delta_natural_key";--> statement-breakpoint
ALTER TABLE "diff_snapshot" DROP CONSTRAINT "diff_snapshot_natural_key";--> statement-breakpoint
ALTER TABLE "hunk_span" DROP CONSTRAINT "hunk_span_natural_key";--> statement-breakpoint
ALTER TABLE "review_session" DROP CONSTRAINT "review_session_natural_key";--> statement-breakpoint
ALTER TABLE "revision_narrative" DROP CONSTRAINT "revision_narrative_natural_key";--> statement-breakpoint
ALTER TABLE "api_token" ALTER COLUMN "installation_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "audit_log" ALTER COLUMN "installation_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "auth_session" ALTER COLUMN "installation_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "brief" ALTER COLUMN "installation_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "checkpoint" ALTER COLUMN "installation_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "comparison_marks" ALTER COLUMN "installation_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "delta" ALTER COLUMN "installation_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "diff_snapshot" ALTER COLUMN "installation_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "disposition" ALTER COLUMN "installation_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "generation" ALTER COLUMN "installation_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "hunk_span" ALTER COLUMN "installation_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "pull_request" ALTER COLUMN "installation_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "review_draft_comment" ALTER COLUMN "installation_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "review_group_reclassification" ALTER COLUMN "installation_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "review_read_mark" ALTER COLUMN "installation_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "review_session" ALTER COLUMN "installation_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "review_submitted_review" ALTER COLUMN "installation_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "revision_narrative" ALTER COLUMN "installation_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "source" text DEFAULT 'app-installation' NOT NULL;--> statement-breakpoint
ALTER TABLE "pull_request" ADD COLUMN "owner_user_id" bigint;--> statement-breakpoint
ALTER TABLE "pull_request" ADD COLUMN "source" text DEFAULT 'app-installation' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "pull_request_owner_natural_key" ON "pull_request" USING btree ("owner_user_id","repo_id","pr_number") WHERE "pull_request"."installation_id" is null;--> statement-breakpoint
ALTER TABLE "brief" ADD CONSTRAINT "brief_natural_key" UNIQUE NULLS NOT DISTINCT("installation_id","pull_request_id","base_sha","head_sha");--> statement-breakpoint
ALTER TABLE "checkpoint" ADD CONSTRAINT "checkpoint_natural_key" UNIQUE NULLS NOT DISTINCT("installation_id","pull_request_id","reviewer_id");--> statement-breakpoint
ALTER TABLE "comparison_marks" ADD CONSTRAINT "comparison_marks_natural_key" UNIQUE NULLS NOT DISTINCT("installation_id","pull_request_id","baseline_sha","head_sha");--> statement-breakpoint
ALTER TABLE "delta" ADD CONSTRAINT "delta_natural_key" UNIQUE NULLS NOT DISTINCT("installation_id","pull_request_id","baseline_sha","head_sha");--> statement-breakpoint
ALTER TABLE "diff_snapshot" ADD CONSTRAINT "diff_snapshot_natural_key" UNIQUE NULLS NOT DISTINCT("installation_id","pull_request_id","sha");--> statement-breakpoint
ALTER TABLE "hunk_span" ADD CONSTRAINT "hunk_span_natural_key" UNIQUE NULLS NOT DISTINCT("installation_id","pull_request_id","baseline_sha","head_sha");--> statement-breakpoint
ALTER TABLE "review_session" ADD CONSTRAINT "review_session_natural_key" UNIQUE NULLS NOT DISTINCT("installation_id","brief_id","reviewer_id");--> statement-breakpoint
ALTER TABLE "revision_narrative" ADD CONSTRAINT "revision_narrative_natural_key" UNIQUE NULLS NOT DISTINCT("installation_id","pull_request_id","prev_head_sha","head_sha");--> statement-breakpoint
ALTER TABLE "pull_request" ADD CONSTRAINT "pull_request_owner_shape" CHECK (
  ("source" = 'app-installation' AND "installation_id" IS NOT NULL AND "owner_user_id" IS NULL)
  OR ("source" = 'url-box' AND "installation_id" IS NULL AND "owner_user_id" IS NOT NULL)
);--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_source_shape" CHECK (
  ("source" = 'app-installation' AND "installation_id" IS NOT NULL)
  OR ("source" = 'url-box' AND "installation_id" IS NULL)
);
