ALTER TABLE "generation_attempt" ADD COLUMN "recorded_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
UPDATE "generation_attempt" SET "recorded_at" = "started_at";
