-- `audit_log.action` gains 'resolve-thread' and 'unresolve-thread'
-- (the thread-resolution routes' emits). Closed-vocabulary swap in lockstep
-- with `AuditAction` in `src/types.ts` — same DROP + ADD pattern as
-- migrations 0007/0010 (forward-only; rollback = drop and re-add the 0010
-- list).
ALTER TABLE "audit_log" DROP CONSTRAINT "audit_log_action_check";
--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_action_check"
CHECK ("action" IN ('generate', 'delete', 'config', 'auth', 'submit', 'mark-ready', 'resolve-thread', 'unresolve-thread'));
