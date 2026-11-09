-- Custom migration: DB-enforce the closed vocabularies + the generation
-- kind/baseline shape. Hand-maintained; drizzle-kit does not
-- regenerate this file. (Drizzle migrations are forward-only by design — no
-- down step; rollback of this file is DROP CONSTRAINT for each name below.)
--
-- Tradeoff accepted: adding a vocabulary value now requires a migration
-- (DROP CONSTRAINT + ADD CONSTRAINT), no longer a code-only change. That
-- matches the repo's register-first protocol (labeling-schema.md) — a closed
-- vocab addition is a recorded decision, and the persistence layer is exactly
-- where "the app treats this as impossible" should be made true. Keep these
-- lists in lockstep with the `as const` maps in `src/types.ts`.

ALTER TABLE "pull_request"
ADD CONSTRAINT "pull_request_state_check"
CHECK ("state" IN ('open', 'closed', 'merged'));
--> statement-breakpoint

-- Lifecycle shape: an open PR can never be armed for the retention sweep
-- (nor carry a close timestamp) — the DB backstop of the TS
-- PullRequestLifecycle union; guards against any future writer (raw SQL,
-- setRetention misuse) recreating the reopen data-loss bug at a layer the
-- type system can't reach.
ALTER TABLE "pull_request"
ADD CONSTRAINT "pull_request_open_retention_shape"
CHECK ("state" <> 'open' OR ("purge_after" IS NULL AND "closed_at" IS NULL));
--> statement-breakpoint

ALTER TABLE "generation"
ADD CONSTRAINT "generation_kind_check"
CHECK ("kind" IN ('brief', 'delta', 'revision-narrative'));
--> statement-breakpoint

ALTER TABLE "generation"
ADD CONSTRAINT "generation_status_check"
CHECK ("status" IN ('queued', 'running', 'succeeded', 'failed'));
--> statement-breakpoint

ALTER TABLE "generation"
ADD CONSTRAINT "generation_phase_check"
CHECK ("phase" IS NULL OR "phase" IN ('fetching', 'redacting', 'generating', 'writing'));
--> statement-breakpoint

-- Shape: a Brief spans the whole PR (no lower bound); the span-keyed kinds
-- (`delta` = checkpoint SHA, `revision-narrative` = prior briefed head) must
-- carry one — mirrors each artifact's own natural key and the
-- GenerationTarget discriminated union in src/generation.ts.
ALTER TABLE "generation"
ADD CONSTRAINT "generation_kind_baseline_shape"
CHECK (
  ("kind" = 'brief' AND "baseline_sha" IS NULL)
  OR ("kind" IN ('delta', 'revision-narrative') AND "baseline_sha" IS NOT NULL)
);
--> statement-breakpoint

ALTER TABLE "disposition"
ADD CONSTRAINT "disposition_decision_check"
CHECK ("decision" IN ('addressed', 'dismissed'));
--> statement-breakpoint

ALTER TABLE "audit_log"
ADD CONSTRAINT "audit_log_actor_type_check"
CHECK ("actor_type" IN ('reviewer', 'app', 'system'));
--> statement-breakpoint

ALTER TABLE "audit_log"
ADD CONSTRAINT "audit_log_action_check"
CHECK ("action" IN ('generate', 'delete', 'config', 'auth'));
--> statement-breakpoint

-- target_type is an open-ended CLASS token (D9), not open text: shape-check
-- it so route/slug/email-like strings can't enter the never-purged ledger
-- through the one non-closed string column. Mirrors AuditTargetTypeSchema.
ALTER TABLE "audit_log"
ADD CONSTRAINT "audit_log_target_type_shape"
CHECK ("target_type" IS NULL OR "target_type" ~ '^[a-z][a-z0-9_]{0,63}$');
