CREATE TABLE IF NOT EXISTS "chunk_layout" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "chunk_layout_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"installation_id" bigint,
	"pull_request_id" bigint NOT NULL,
	"brief_id" bigint NOT NULL,
	"body" text NOT NULL,
	"byte_size" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "chunk_layout" ADD CONSTRAINT "chunk_layout_pull_request_id_pull_request_id_fk" FOREIGN KEY ("pull_request_id") REFERENCES "public"."pull_request"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "chunk_layout" ADD CONSTRAINT "chunk_layout_brief_id_brief_id_fk" FOREIGN KEY ("brief_id") REFERENCES "public"."brief"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "chunk_layout_brief_id_key" ON "chunk_layout" USING btree ("brief_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chunk_layout_pull_request_idx" ON "chunk_layout" USING btree ("pull_request_id");
