ALTER TABLE "review_draft_comment" ADD COLUMN "start_side" text;--> statement-breakpoint
-- Keep the value list in lockstep with the `as const` maps in `src/types.ts`.
-- Non-null start_side must genuinely cross sides; equal-to-side is normalized
-- to NULL before the store. Rollback: drop the constraint.
ALTER TABLE "review_draft_comment" ADD CONSTRAINT "review_draft_comment_start_side_check"
CHECK ("start_side" IS NULL OR ("start_side" IN ('old', 'new') AND "start_side" <> "side"));--> statement-breakpoint
-- Cross-side line numbers are not comparable; the ordered-range guarantee
-- applies only to same-side ranges.
ALTER TABLE "review_draft_comment" DROP CONSTRAINT "review_draft_comment_line_range_shape";--> statement-breakpoint
ALTER TABLE "review_draft_comment" ADD CONSTRAINT "review_draft_comment_line_range_shape"
CHECK ("start_line" > 0 AND "end_line" > 0 AND ("start_side" IS NOT NULL OR "end_line" >= "start_line"));
