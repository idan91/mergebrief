CREATE TABLE "generation_part" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "generation_part_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"installation_id" bigint,
	"pull_request_id" bigint NOT NULL,
	"base_sha" text NOT NULL,
	"head_sha" text NOT NULL,
	"part_key" text NOT NULL,
	"body" text NOT NULL,
	"byte_size" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "generation_part_natural_key" UNIQUE NULLS NOT DISTINCT("installation_id","pull_request_id","base_sha","head_sha","part_key"),
	CONSTRAINT "generation_part_part_key_check" CHECK ("generation_part"."part_key" ~ '^[a-z][a-z0-9]*(:[a-z0-9]+)*$')
);
--> statement-breakpoint
ALTER TABLE "generation_part" ADD CONSTRAINT "generation_part_pull_request_id_pull_request_id_fk" FOREIGN KEY ("pull_request_id") REFERENCES "public"."pull_request"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "generation_part_pull_request_idx" ON "generation_part" USING btree ("pull_request_id");