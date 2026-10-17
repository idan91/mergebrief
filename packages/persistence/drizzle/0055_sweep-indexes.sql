CREATE INDEX "audit_log_occurred_at_idx" ON "audit_log" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "auth_session_expires_at_idx" ON "auth_session" USING btree ("expires_at");