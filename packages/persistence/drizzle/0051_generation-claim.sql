CREATE TABLE "generation_attempt" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "generation_attempt_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"installation_id" bigint,
	"run_id" uuid NOT NULL,
	"generation_id" bigint NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "generation_attempt_run_id_key" UNIQUE("run_id")
);
--> statement-breakpoint
ALTER TABLE "generation" ADD COLUMN "run_id" uuid;--> statement-breakpoint
ALTER TABLE "generation" ADD COLUMN "lease_expires_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "generation_attempt_started_at_idx" ON "generation_attempt" USING btree ("started_at");