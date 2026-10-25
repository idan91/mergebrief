-- widens generation_status_check
ALTER TABLE "generation" DROP CONSTRAINT "generation_status_check";--> statement-breakpoint
ALTER TABLE "pull_request" ADD COLUMN "trigger_approved_by" bigint;--> statement-breakpoint
ALTER TABLE "pull_request" ADD COLUMN "trigger_approved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "generation" ADD CONSTRAINT "generation_status_check" CHECK ("generation"."status" in ('pending', 'running', 'succeeded', 'failed', 'superseded', 'capped', 'awaiting-trigger'));--> statement-breakpoint
ALTER TABLE "pull_request" ADD CONSTRAINT "pull_request_trigger_approval_shape" CHECK (("pull_request"."trigger_approved_by" is null) = ("pull_request"."trigger_approved_at" is null));