-- `generation.status` renames 'queued' to 'pending': a Job is queued, a
-- Generation is pending. Closed-vocabulary swap in lockstep with
-- `GenerationStatus` in `src/types.ts`, same DROP + ADD pattern as migration
-- 0015. Pre-release, so the rows move rather than a compatibility value
-- lingering (forward-only; rollback = the 0015 list plus the reverse update).
ALTER TABLE "generation" DROP CONSTRAINT "generation_status_check";
--> statement-breakpoint
UPDATE "generation" SET "status" = 'pending' WHERE "status" = 'queued';
--> statement-breakpoint
ALTER TABLE "generation" ADD CONSTRAINT "generation_status_check"
CHECK ("status" IN ('pending', 'running', 'succeeded', 'failed', 'superseded', 'capped'));
