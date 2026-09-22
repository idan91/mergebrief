ALTER TABLE "pull_request" ADD COLUMN "github_read_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "pull_request" ADD COLUMN "github_head_sha" text;--> statement-breakpoint
ALTER TABLE "pull_request" ADD COLUMN "github_unreachable_at" timestamp with time zone;