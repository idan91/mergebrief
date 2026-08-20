ALTER TABLE "disposition" ADD COLUMN "review_session_id" bigint NOT NULL;--> statement-breakpoint
ALTER TABLE "disposition" ADD COLUMN "carry_status" text;--> statement-breakpoint
ALTER TABLE "disposition" ADD COLUMN "evidence_status" text;--> statement-breakpoint
ALTER TABLE "disposition" ADD CONSTRAINT "disposition_review_session_id_review_session_id_fk" FOREIGN KEY ("review_session_id") REFERENCES "public"."review_session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disposition" ADD CONSTRAINT "disposition_natural_key" UNIQUE("review_session_id","file_path","attribute","region_start","region_end");--> statement-breakpoint
-- Keep these lists in lockstep with the `as const` maps in `src/types.ts`.
-- Rollback: drop the constraint.
ALTER TABLE "disposition" ADD CONSTRAINT "disposition_carry_status_check"
CHECK ("carry_status" IS NULL OR "carry_status" IN ('new', 'reopened', 'settled', 'dropped'));--> statement-breakpoint
ALTER TABLE "disposition" ADD CONSTRAINT "disposition_evidence_status_check"
CHECK ("evidence_status" IS NULL OR "evidence_status" IN ('missing-evidence'));
