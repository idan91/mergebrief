CREATE INDEX "api_token_grant_idx" ON "api_token" USING btree ("grant_id");--> statement-breakpoint
CREATE INDEX "auth_session_grant_idx" ON "auth_session" USING btree ("grant_id");--> statement-breakpoint
CREATE INDEX "checkpoint_pull_request_idx" ON "checkpoint" USING btree ("pull_request_id");--> statement-breakpoint
CREATE INDEX "comparison_marks_pull_request_idx" ON "comparison_marks" USING btree ("pull_request_id");--> statement-breakpoint
CREATE INDEX "delta_pull_request_idx" ON "delta" USING btree ("pull_request_id");--> statement-breakpoint
CREATE INDEX "hunk_span_pull_request_idx" ON "hunk_span" USING btree ("pull_request_id");--> statement-breakpoint
CREATE INDEX "review_draft_comment_carried_from_session_idx" ON "review_draft_comment" USING btree ("carried_from_session_id") WHERE "review_draft_comment"."carried_from_session_id" is not null;--> statement-breakpoint
CREATE INDEX "review_session_brief_idx" ON "review_session" USING btree ("brief_id");--> statement-breakpoint
CREATE INDEX "revision_narrative_pull_request_idx" ON "revision_narrative" USING btree ("pull_request_id");--> statement-breakpoint
CREATE INDEX "revision_narrative_brief_idx" ON "revision_narrative" USING btree ("brief_id");