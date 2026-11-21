ALTER TABLE "pull_request" ADD COLUMN "review_requested_met_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "pull_request" ADD COLUMN "paths_met_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "pull_request" ADD COLUMN "paths_met_digest" text;--> statement-breakpoint
ALTER TABLE "pull_request" ADD CONSTRAINT "pull_request_paths_met_shape" CHECK (("pull_request"."paths_met_at" is null) = ("pull_request"."paths_met_digest" is null));