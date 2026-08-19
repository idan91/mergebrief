CREATE TABLE "review_draft_comment" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "review_draft_comment_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"installation_id" bigint NOT NULL,
	"review_session_id" bigint NOT NULL,
	"file_path" text NOT NULL,
	"side" text NOT NULL,
	"start_line" integer NOT NULL,
	"end_line" integer NOT NULL,
	"body" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"anchor_status" text,
	"carried_from_session_id" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review_group_reclassification" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "review_group_reclassification_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"installation_id" bigint NOT NULL,
	"review_session_id" bigint NOT NULL,
	"change_group_id" text NOT NULL,
	"category" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "review_group_reclassification_natural_key" UNIQUE("review_session_id","change_group_id")
);
--> statement-breakpoint
CREATE TABLE "review_read_mark" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "review_read_mark_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"installation_id" bigint NOT NULL,
	"review_session_id" bigint NOT NULL,
	"chunk_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "review_read_mark_natural_key" UNIQUE("review_session_id","chunk_id")
);
--> statement-breakpoint
CREATE TABLE "review_session" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "review_session_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"installation_id" bigint NOT NULL,
	"brief_id" bigint NOT NULL,
	"reviewer_id" bigint NOT NULL,
	"review_outcome" text DEFAULT 'comment' NOT NULL,
	"begun_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "review_session_natural_key" UNIQUE("installation_id","brief_id","reviewer_id")
);
--> statement-breakpoint
CREATE TABLE "review_submitted_review" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "review_submitted_review_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"installation_id" bigint NOT NULL,
	"review_session_id" bigint NOT NULL,
	"github_review_id" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "review_submitted_review_natural_key" UNIQUE("review_session_id","github_review_id")
);
--> statement-breakpoint
ALTER TABLE "review_draft_comment" ADD CONSTRAINT "review_draft_comment_review_session_id_review_session_id_fk" FOREIGN KEY ("review_session_id") REFERENCES "public"."review_session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_draft_comment" ADD CONSTRAINT "review_draft_comment_carried_from_session_id_review_session_id_fk" FOREIGN KEY ("carried_from_session_id") REFERENCES "public"."review_session"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_group_reclassification" ADD CONSTRAINT "review_group_reclassification_review_session_id_review_session_id_fk" FOREIGN KEY ("review_session_id") REFERENCES "public"."review_session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_read_mark" ADD CONSTRAINT "review_read_mark_review_session_id_review_session_id_fk" FOREIGN KEY ("review_session_id") REFERENCES "public"."review_session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_session" ADD CONSTRAINT "review_session_brief_id_brief_id_fk" FOREIGN KEY ("brief_id") REFERENCES "public"."brief"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_submitted_review" ADD CONSTRAINT "review_submitted_review_review_session_id_review_session_id_fk" FOREIGN KEY ("review_session_id") REFERENCES "public"."review_session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "review_draft_comment_session_idx" ON "review_draft_comment" USING btree ("review_session_id");--> statement-breakpoint
-- Keep these lists in lockstep with the `as const` maps in `src/types.ts`.
-- Rollback: drop the constraint.
ALTER TABLE "review_session" ADD CONSTRAINT "review_session_review_outcome_check"
CHECK ("review_outcome" IN ('comment', 'approve', 'request-changes'));--> statement-breakpoint
ALTER TABLE "review_draft_comment" ADD CONSTRAINT "review_draft_comment_status_check"
CHECK ("status" IN ('draft', 'submitted'));--> statement-breakpoint
ALTER TABLE "review_draft_comment" ADD CONSTRAINT "review_draft_comment_side_check"
CHECK ("side" IN ('old', 'new'));--> statement-breakpoint
ALTER TABLE "review_draft_comment" ADD CONSTRAINT "review_draft_comment_anchor_status_check"
CHECK ("anchor_status" IS NULL OR "anchor_status" IN ('moved', 'orphaned'));--> statement-breakpoint
ALTER TABLE "review_group_reclassification" ADD CONSTRAINT "review_group_reclassification_category_check"
CHECK ("category" IN ('bugfix', 'logic-refactor', 'move-with-edits', 'lib-bump', 'pure-move', 'new-feature', 'dependency-update', 'schema-change'));--> statement-breakpoint
-- A draft comment's coordinates ARE the GitHub POST payload; an inverted or
-- non-positive range can only fail at publish time.
ALTER TABLE "review_draft_comment" ADD CONSTRAINT "review_draft_comment_line_range_shape"
CHECK ("start_line" > 0 AND "end_line" >= "start_line");
