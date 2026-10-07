-- widens generation_error_code_check
ALTER TABLE "generation" ADD COLUMN "claims" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "generation" DROP CONSTRAINT "generation_error_code_check";--> statement-breakpoint
ALTER TABLE "generation" ADD CONSTRAINT "generation_error_code_check"
CHECK ("error_code" IS NULL OR "error_code" IN ('provider-auth', 'provider-rate-limit', 'provider-timeout', 'provider-unavailable', 'provider-refusal', 'output-invalid', 'generation-config', 'github-access', 'diff-too-large', 'github-unavailable', 'attempts-exhausted', 'unknown'));
