-- widens generation_status_check
ALTER TABLE "generation" DROP CONSTRAINT "generation_status_check";--> statement-breakpoint
ALTER TABLE "generation" ADD COLUMN "unmet_conditions" text;--> statement-breakpoint
ALTER TABLE "generation" ADD COLUMN "generate_requested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "generation" ADD CONSTRAINT "generation_unmet_conditions_check" CHECK ("generation"."unmet_conditions" is json array);--> statement-breakpoint
ALTER TABLE "generation" ADD CONSTRAINT "generation_held_has_conditions" CHECK ("generation"."status" <> 'held' or "generation"."unmet_conditions" is not null);--> statement-breakpoint
ALTER TABLE "generation" ADD CONSTRAINT "generation_status_check" CHECK ("generation"."status" in ('pending', 'running', 'succeeded', 'failed', 'superseded', 'capped', 'awaiting-trigger', 'held'));
