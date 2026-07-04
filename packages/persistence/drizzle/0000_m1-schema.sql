CREATE TABLE "audit_log" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "audit_log_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"installation_id" bigint NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_type" text NOT NULL,
	"actor_id" bigint,
	"action" text NOT NULL,
	"target_type" text,
	"target_id" bigint,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE "brief" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "brief_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"installation_id" bigint NOT NULL,
	"pull_request_id" bigint NOT NULL,
	"base_sha" text NOT NULL,
	"head_sha" text NOT NULL,
	"head_index" integer NOT NULL,
	"commit_count" integer NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"effort" text NOT NULL,
	"body" text NOT NULL,
	"byte_size" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "brief_natural_key" UNIQUE("installation_id","pull_request_id","base_sha","head_sha")
);
--> statement-breakpoint
CREATE TABLE "checkpoint" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "checkpoint_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"installation_id" bigint NOT NULL,
	"pull_request_id" bigint NOT NULL,
	"reviewer_id" bigint NOT NULL,
	"reviewer_login" text,
	"last_submitted_sha" text NOT NULL,
	"submitted_at" timestamp with time zone NOT NULL,
	CONSTRAINT "checkpoint_natural_key" UNIQUE("installation_id","pull_request_id","reviewer_id")
);
--> statement-breakpoint
CREATE TABLE "comparison_marks" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "comparison_marks_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"installation_id" bigint NOT NULL,
	"pull_request_id" bigint NOT NULL,
	"baseline_sha" text NOT NULL,
	"head_sha" text NOT NULL,
	"body" text NOT NULL,
	"byte_size" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "comparison_marks_natural_key" UNIQUE("installation_id","pull_request_id","baseline_sha","head_sha")
);
--> statement-breakpoint
CREATE TABLE "delta" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "delta_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"installation_id" bigint NOT NULL,
	"pull_request_id" bigint NOT NULL,
	"baseline_sha" text NOT NULL,
	"head_sha" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"effort" text NOT NULL,
	"body" text NOT NULL,
	"byte_size" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "delta_natural_key" UNIQUE("installation_id","pull_request_id","baseline_sha","head_sha")
);
--> statement-breakpoint
CREATE TABLE "diff_snapshot" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "diff_snapshot_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"installation_id" bigint NOT NULL,
	"pull_request_id" bigint NOT NULL,
	"sha" text NOT NULL,
	"body" text NOT NULL,
	"byte_size" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "diff_snapshot_natural_key" UNIQUE("installation_id","pull_request_id","sha")
);
--> statement-breakpoint
CREATE TABLE "disposition" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "disposition_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"installation_id" bigint NOT NULL,
	"pull_request_id" bigint NOT NULL,
	"reviewer_id" bigint NOT NULL,
	"file_path" text NOT NULL,
	"attribute" text NOT NULL,
	"region_start" integer NOT NULL,
	"region_end" integer NOT NULL,
	"decided_at_sha" text NOT NULL,
	"decision" text NOT NULL,
	"reason" text,
	"decided_at" timestamp with time zone NOT NULL,
	CONSTRAINT "disposition_natural_key" UNIQUE("installation_id","pull_request_id","reviewer_id","file_path","attribute","region_start","region_end","decided_at_sha")
);
--> statement-breakpoint
CREATE TABLE "generation" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "generation_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"installation_id" bigint NOT NULL,
	"pull_request_id" bigint NOT NULL,
	"kind" text NOT NULL,
	"head_sha" text NOT NULL,
	"baseline_sha" text,
	"status" text NOT NULL,
	"phase" text,
	"error" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "generation_natural_key" UNIQUE NULLS NOT DISTINCT("installation_id","pull_request_id","kind","head_sha","baseline_sha")
);
--> statement-breakpoint
CREATE TABLE "pull_request" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "pull_request_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"installation_id" bigint NOT NULL,
	"repo_id" bigint NOT NULL,
	"pr_number" integer NOT NULL,
	"repo_slug" text,
	"state" text NOT NULL,
	"closed_at" timestamp with time zone,
	"purge_after" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pull_request_natural_key" UNIQUE("installation_id","repo_id","pr_number")
);
--> statement-breakpoint
CREATE TABLE "reviewer_session" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "reviewer_session_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"installation_id" bigint NOT NULL,
	"session_token_hash" text NOT NULL,
	"reviewer_id" bigint NOT NULL,
	"reviewer_login" text,
	"gh_token_ciphertext" text NOT NULL,
	"key_ref" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reviewer_session_session_token_hash_unique" UNIQUE("session_token_hash")
);
--> statement-breakpoint
CREATE TABLE "revision_narrative" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "revision_narrative_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"installation_id" bigint NOT NULL,
	"pull_request_id" bigint NOT NULL,
	"brief_id" bigint NOT NULL,
	"prev_head_sha" text NOT NULL,
	"head_sha" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"effort" text NOT NULL,
	"body" text NOT NULL,
	"byte_size" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "revision_narrative_natural_key" UNIQUE("installation_id","pull_request_id","prev_head_sha","head_sha")
);
--> statement-breakpoint
ALTER TABLE "brief" ADD CONSTRAINT "brief_pull_request_id_pull_request_id_fk" FOREIGN KEY ("pull_request_id") REFERENCES "public"."pull_request"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checkpoint" ADD CONSTRAINT "checkpoint_pull_request_id_pull_request_id_fk" FOREIGN KEY ("pull_request_id") REFERENCES "public"."pull_request"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comparison_marks" ADD CONSTRAINT "comparison_marks_pull_request_id_pull_request_id_fk" FOREIGN KEY ("pull_request_id") REFERENCES "public"."pull_request"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delta" ADD CONSTRAINT "delta_pull_request_id_pull_request_id_fk" FOREIGN KEY ("pull_request_id") REFERENCES "public"."pull_request"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diff_snapshot" ADD CONSTRAINT "diff_snapshot_pull_request_id_pull_request_id_fk" FOREIGN KEY ("pull_request_id") REFERENCES "public"."pull_request"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disposition" ADD CONSTRAINT "disposition_pull_request_id_pull_request_id_fk" FOREIGN KEY ("pull_request_id") REFERENCES "public"."pull_request"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation" ADD CONSTRAINT "generation_pull_request_id_pull_request_id_fk" FOREIGN KEY ("pull_request_id") REFERENCES "public"."pull_request"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revision_narrative" ADD CONSTRAINT "revision_narrative_pull_request_id_pull_request_id_fk" FOREIGN KEY ("pull_request_id") REFERENCES "public"."pull_request"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revision_narrative" ADD CONSTRAINT "revision_narrative_brief_id_brief_id_fk" FOREIGN KEY ("brief_id") REFERENCES "public"."brief"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "reviewer_session_installation_reviewer_idx" ON "reviewer_session" USING btree ("installation_id","reviewer_id");