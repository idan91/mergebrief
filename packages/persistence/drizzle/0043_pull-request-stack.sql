ALTER TABLE "pull_request" ADD COLUMN "stack" jsonb;--> statement-breakpoint
ALTER TABLE "pull_request" ADD COLUMN "stack_read_at" timestamp with time zone;