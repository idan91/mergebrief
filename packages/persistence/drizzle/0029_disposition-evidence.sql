ALTER TABLE "disposition" ADD COLUMN "evidence_kind" text;--> statement-breakpoint
ALTER TABLE "disposition" ADD COLUMN "evidence_ref" text;--> statement-breakpoint
-- Keep this list in lockstep with the `as const` map in `src/types.ts`.
-- Rollback: drop the constraint.
ALTER TABLE "disposition" ADD CONSTRAINT "disposition_evidence_kind_check"
CHECK ("evidence_kind" IS NULL OR "evidence_kind" IN ('linked-comment', 'chunk-reviewed', 'manual-note'));
