-- contracts 0.1.0
UPDATE "generation" SET "error_code" = 'unknown' WHERE "status" = 'failed' AND "error_code" IS NULL;--> statement-breakpoint
UPDATE "generation" SET "run_id" = NULL, "lease_expires_at" = NULL WHERE "run_id" IS NOT NULL AND "status" <> 'running';--> statement-breakpoint
-- A claim with no lease reads as lapsed, so the head's recovery job may take it over.
UPDATE "generation" SET "lease_expires_at" = now() WHERE "run_id" IS NOT NULL AND "lease_expires_at" IS NULL;--> statement-breakpoint
UPDATE "generation" SET "lease_expires_at" = NULL WHERE "run_id" IS NULL AND "lease_expires_at" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "generation" ADD CONSTRAINT "generation_failed_has_code" CHECK ("generation"."status" <> 'failed' or "generation"."error_code" is not null);--> statement-breakpoint
ALTER TABLE "generation" ADD CONSTRAINT "generation_claim_has_lease" CHECK (("generation"."run_id" is null) = ("generation"."lease_expires_at" is null));--> statement-breakpoint
ALTER TABLE "generation" ADD CONSTRAINT "generation_claim_is_running" CHECK ("generation"."run_id" is null or "generation"."status" in ('running'));
