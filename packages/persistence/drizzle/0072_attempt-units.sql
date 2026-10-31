-- contracts 0.1.0
ALTER TABLE "generation_attempt" ADD COLUMN "units" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "generation_attempt" ADD COLUMN "parts_done" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "generation_attempt" ADD CONSTRAINT "generation_attempt_units_check" CHECK ("generation_attempt"."units" >= 1);--> statement-breakpoint
ALTER TABLE "generation_attempt" ADD CONSTRAINT "generation_attempt_parts_done_check" CHECK ("generation_attempt"."parts_done" >= 0);