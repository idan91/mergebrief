-- Schema additions. NOTE for operators:
-- the `gh_refresh_token_ciphertext NOT NULL` add has no DEFAULT and so assumes
-- `reviewer_session` is EMPTY at apply time — true in M1 (reviewer OAuth ships
-- in a later PR, so no session rows exist yet). If you somehow have live
-- sessions, delete them before applying (they are short-lived and re-created on
-- next login) — there is no meaningful backfill for a refresh-token ciphertext.
ALTER TABLE "pull_request" ADD COLUMN "entry_comment_id" bigint;--> statement-breakpoint
ALTER TABLE "reviewer_session" ADD COLUMN "gh_refresh_token_ciphertext" text NOT NULL;--> statement-breakpoint

-- Hand-appended: add `superseded` to the generation.status closed
-- vocabulary in lockstep with the `as const` map in src/types.ts, mirroring
-- 0002's register-first protocol. drizzle-kit does not manage this CHECK, so
-- the swap is DROP CONSTRAINT + ADD CONSTRAINT (forward-only; rollback = drop
-- the constraint below). `superseded` = terminal abort-on-supersession
-- (ADR 0006 #6): a mid-call generation aborted because the head advanced.
ALTER TABLE "generation" DROP CONSTRAINT "generation_status_check";
--> statement-breakpoint
ALTER TABLE "generation" ADD CONSTRAINT "generation_status_check"
CHECK ("status" IN ('queued', 'running', 'succeeded', 'failed', 'superseded'));