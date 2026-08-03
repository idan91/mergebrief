-- BRIEF-20: `generation.status` gains 'capped' — the terminal skip a repo's
-- daily generation cap produces (spend guardrail). Closed-vocabulary swap in
-- lockstep with `GenerationStatus` in `src/types.ts` — same DROP + ADD
-- pattern as migration 0003 (forward-only; rollback = drop and re-add the
-- 0003 list, which also requires no 'capped' rows to exist).
ALTER TABLE "generation" DROP CONSTRAINT "generation_status_check";
--> statement-breakpoint
ALTER TABLE "generation" ADD CONSTRAINT "generation_status_check"
CHECK ("status" IN ('queued', 'running', 'succeeded', 'failed', 'superseded', 'capped'));
--> statement-breakpoint
-- Hand-written index (same posture as migration 0001 — drizzle-kit does not
-- regenerate it; rollback = DROP INDEX). The cap counter
-- (`countStartedRunsForRepo`) asks "how many runs did this tenant start
-- TODAY", then narrows to one repo through the pull_request join. Without
-- this index the planner drives from the repo's whole PR history — cost
-- growing with total historical volume for an answer bounded by one day.
-- Leading installation_id keeps it aligned with every other read here.
CREATE INDEX "generation_installation_created_at_idx" ON "generation" USING btree ("installation_id", "created_at");
