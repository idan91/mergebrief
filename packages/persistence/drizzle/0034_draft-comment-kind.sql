ALTER TABLE "review_draft_comment" ADD COLUMN "kind" text DEFAULT 'line' NOT NULL;--> statement-breakpoint
ALTER TABLE "review_draft_comment" ALTER COLUMN "side" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "review_draft_comment" ALTER COLUMN "start_line" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "review_draft_comment" ALTER COLUMN "end_line" DROP NOT NULL;--> statement-breakpoint
-- Keep the value list in lockstep with the `as const` maps in `src/types.ts`.
-- Rollback: drop the constraint.
ALTER TABLE "review_draft_comment" ADD CONSTRAINT "review_draft_comment_kind_check"
CHECK ("kind" IN ('line', 'file'));--> statement-breakpoint
-- A File comment has no line; a Line comment keeps today's range shape.
-- Rollback: restore review_draft_comment_line_range_shape from 0032.
ALTER TABLE "review_draft_comment" DROP CONSTRAINT "review_draft_comment_line_range_shape";--> statement-breakpoint
ALTER TABLE "review_draft_comment" ADD CONSTRAINT "review_draft_comment_anchor_shape"
CHECK (
  (
    "kind" = 'line'
    AND "side" IS NOT NULL
    AND "start_line" IS NOT NULL
    AND "end_line" IS NOT NULL
    AND "start_line" > 0
    AND "end_line" > 0
    AND ("start_side" IS NOT NULL OR "end_line" >= "start_line")
  )
  OR (
    "kind" = 'file'
    AND "start_line" IS NULL
    AND "end_line" IS NULL
    AND "side" IS NULL
    AND "start_side" IS NULL
  )
);
