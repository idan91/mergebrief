CREATE TABLE "hunk_span" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "hunk_span_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"installation_id" bigint NOT NULL,
	"pull_request_id" bigint NOT NULL,
	"baseline_sha" text NOT NULL,
	"head_sha" text NOT NULL,
	"spans" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hunk_span_natural_key" UNIQUE("installation_id","pull_request_id","baseline_sha","head_sha")
);
--> statement-breakpoint
ALTER TABLE "hunk_span" ADD CONSTRAINT "hunk_span_pull_request_id_pull_request_id_fk" FOREIGN KEY ("pull_request_id") REFERENCES "public"."pull_request"("id") ON DELETE cascade ON UPDATE no action;