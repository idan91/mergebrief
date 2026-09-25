CREATE TABLE "inbox_archive" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "inbox_archive_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"installation_id" bigint,
	"pull_request_id" bigint NOT NULL,
	"reviewer_id" bigint NOT NULL,
	"head_sha" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inbox_archive_natural_key" UNIQUE NULLS NOT DISTINCT("installation_id","pull_request_id","reviewer_id")
);
--> statement-breakpoint
ALTER TABLE "inbox_archive" ADD CONSTRAINT "inbox_archive_pull_request_id_pull_request_id_fk" FOREIGN KEY ("pull_request_id") REFERENCES "public"."pull_request"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "inbox_archive_pull_request_reviewer_idx" ON "inbox_archive" USING btree ("pull_request_id","reviewer_id");