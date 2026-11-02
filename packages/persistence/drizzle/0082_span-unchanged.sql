ALTER TABLE "delta" ADD COLUMN "unchanged" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "revision_narrative" ADD COLUMN "unchanged" boolean DEFAULT false NOT NULL;