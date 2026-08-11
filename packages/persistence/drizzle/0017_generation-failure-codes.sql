-- `generation.error` (free text) becomes `error_code` (closed vocabulary,
-- CHECK-constrained in lockstep with `GenerationFailureCode` in
-- `src/types.ts`) + `error_params` (jsonb interpolation params). Existing
-- failure text is MIGRATED, not wiped: it becomes `unknown` with the old
-- sanitized line as `detail`. Forward-only, like every vocabulary migration.
ALTER TABLE "generation" ADD COLUMN "error_code" text;--> statement-breakpoint
ALTER TABLE "generation" ADD COLUMN "error_params" jsonb;--> statement-breakpoint
-- Hand-written (same posture as migrations 0002/0015 — drizzle-kit does not
-- model CHECKs or data moves; rollback = drop the constraint).
ALTER TABLE "generation" ADD CONSTRAINT "generation_error_code_check"
CHECK ("error_code" IS NULL OR "error_code" IN ('provider-auth', 'provider-rate-limit', 'provider-timeout', 'provider-unavailable', 'provider-refusal', 'output-invalid', 'generation-config', 'github-access', 'diff-too-large', 'github-unavailable', 'unknown'));--> statement-breakpoint
UPDATE "generation" SET "error_code" = 'unknown', "error_params" = jsonb_build_object('detail', "error") WHERE "error" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "generation" DROP COLUMN "error";