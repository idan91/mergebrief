-- widens generation_attempt_units_check
ALTER TABLE "generation_attempt" DROP CONSTRAINT "generation_attempt_units_check";--> statement-breakpoint
ALTER TABLE "generation_attempt" ADD CONSTRAINT "generation_attempt_units_check" CHECK ("generation_attempt"."units" >= 0);