-- BRIEF-23: `audit_log.action` gains 'submit' (the review-submit route's
-- emit). Closed-vocabulary swap in lockstep with `AuditAction` in
-- `src/types.ts` — same DROP + ADD pattern as migration 0003 (forward-only;
-- rollback = drop and re-add the 0002 list).
ALTER TABLE "audit_log" DROP CONSTRAINT "audit_log_action_check";
--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_action_check"
CHECK ("action" IN ('generate', 'delete', 'config', 'auth', 'submit'));
